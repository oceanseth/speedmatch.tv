/**
 * Token broker for Boson Higgs Realtime.
 *
 * Security spec (Claude-Opus, channel thread 2026-09-18):
 * - BOSON_API_KEY never reaches the browser. The browser gets a short-lived
 *   ephemeral client secret minted here (POST /v1/realtime/client_secrets)
 *   and connects with the `bai-client-secret.<key>` subprotocol.
 * - The mint endpoint is authenticated and rate-limited per user.
 * - Spectators are read-only: only the session owner may mint.
 *
 * The handler is a Web-standard (Request → Response) function so it mounts
 * directly as a Next.js App Router route handler:
 *   export const POST = createTokenBrokerHandler({ authorize });
 */

import { config } from '../config.ts';

const BOSON_API = 'https://api.boson.ai/v1';
export const REALTIME_WS_URL = 'wss://api.boson.ai/v1/realtime?model=higgs-realtime';

export interface ClientSecret {
  /** The ephemeral key, `bai-eph-…`. Safe for the browser. */
  value: string;
  /** Epoch seconds. */
  expiresAt: number;
  sessionId: string | null;
}

export interface MintOptions {
  /** 10–7200 per Boson docs; clamped. Default: one pitch leg + slack. */
  expiresSeconds?: number;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export async function mintClientSecret(opts: MintOptions = {}): Promise<ClientSecret> {
  const apiKey = opts.apiKey ?? process.env.BOSON_API_KEY;
  if (!apiKey) throw new Error('BOSON_API_KEY is not set (bind it via `insta secrets set`)');
  const doFetch = opts.fetchImpl ?? fetch;
  const seconds = Math.min(7200, Math.max(10, opts.expiresSeconds ?? config.clientSecretSeconds));

  const res = await doFetch(`${BOSON_API}/realtime/client_secrets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expires_after: { seconds } }),
  });
  if (!res.ok) {
    // Deliberately not echoing the response body: upstream errors can quote
    // request headers.
    throw new Error(`Boson client_secrets mint failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    value: string;
    expires_at: number;
    session?: { id?: string };
  };
  return {
    value: json.value,
    expiresAt: json.expires_at,
    sessionId: json.session?.id ?? null,
  };
}

/** Sliding-window in-memory rate limiter. Per-process; fine for one compute. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs = 60_000,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

export interface TokenBrokerDeps {
  /**
   * Resolve the authenticated user for this request, or null to reject.
   * The transport layer also decides ownership: only the user running the
   * session gets a speaking credential — never spectators.
   */
  authorize: (req: Request) => Promise<{ userId: string } | null>;
  rateLimiter?: RateLimiter;
  mint?: (opts?: MintOptions) => Promise<ClientSecret>;
}

export function createTokenBrokerHandler(deps: TokenBrokerDeps) {
  const limiter = deps.rateLimiter ?? new RateLimiter(config.tokenMintsPerMinute);
  const mint = deps.mint ?? mintClientSecret;

  return async function handler(req: Request): Promise<Response> {
    const user = await deps.authorize(req);
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
    if (!limiter.allow(user.userId)) {
      return Response.json({ error: 'rate_limited' }, { status: 429 });
    }
    try {
      const secret = await mint();
      return Response.json({
        clientSecret: secret.value,
        expiresAt: secret.expiresAt,
        wsUrl: REALTIME_WS_URL,
        subprotocols: ['realtime', `bai-client-secret.${secret.value}`],
      });
    } catch {
      // No upstream detail to the client; it may describe our server env.
      return Response.json({ error: 'mint_failed' }, { status: 502 });
    }
  };
}
