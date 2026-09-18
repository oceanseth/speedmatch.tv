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

/**
 * Sliding-window in-memory rate limiter. Per-process; fine for one compute.
 * Stale keys are evicted on a periodic sweep so unbounded distinct keys
 * (e.g. attacker-rotated user ids) cannot grow the map forever.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private allowCalls = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs = 60_000,
    private readonly sweepEvery = 1000,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    if (++this.allowCalls % this.sweepEvery === 0) this.sweep(now);
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

  sweep(now = Date.now()): void {
    const cutoff = now - this.windowMs;
    for (const [key, times] of this.hits) {
      if (!times.some((t) => t > cutoff)) this.hits.delete(key);
    }
  }

  get trackedKeys(): number {
    return this.hits.size;
  }
}

export interface MintGrant {
  userId: string;
  /** The tournament the caller claims to be running — authorize() must
   * verify ownership: only the session owner mints, spectators never do. */
  tournamentId: string;
}

export interface TokenBrokerDeps {
  /**
   * Resolve the authenticated caller AND verify they own the tournament
   * they're minting for; return null to reject. A userId alone is not
   * enough — under light auth it is user-chosen, and a spectator with a
   * valid login must still be refused.
   */
  authorize: (req: Request) => Promise<MintGrant | null>;
  /**
   * Non-user-chosen rate-limit dimension for this request (client IP or
   * connection id). Default reads the first hop of x-forwarded-for.
   */
  clientKey?: (req: Request) => string;
  /** Audit hook: append a TOKEN_MINTED row to session_events. */
  onMint?: (grant: MintGrant, secret: ClientSecret) => Promise<void>;
  userLimiter?: RateLimiter;
  ipLimiter?: RateLimiter;
  /** Post-auth process-wide mint budget (guards prepaid Boson spend). */
  globalLimiter?: RateLimiter;
  /** Pre-auth process-wide cap on raw request volume. */
  preAuthLimiter?: RateLimiter;
  mint?: (opts?: MintOptions) => Promise<ClientSecret>;
}

/**
 * Rate-limit key that the client cannot choose. We sit behind Cloudflare
 * (which APPENDS the true client IP to x-forwarded-for), so the leftmost
 * hop is attacker-typed — one spoofed header per request would rotate the
 * key. Prefer CF-Connecting-IP; fall back to the RIGHTMOST XFF hop (the one
 * added by the nearest trusted proxy).
 */
export function defaultClientKey(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const hops = req.headers.get('x-forwarded-for')?.split(',') ?? [];
  return hops.at(-1)?.trim() || 'unknown';
}

export function createTokenBrokerHandler(deps: TokenBrokerDeps) {
  const userLimiter = deps.userLimiter ?? new RateLimiter(config.tokenMintsPerMinute);
  const ipLimiter = deps.ipLimiter ?? new RateLimiter(config.tokenMintsPerMinutePerIp);
  const globalLimiter =
    deps.globalLimiter ?? new RateLimiter(config.tokenMintsPerMinuteGlobal);
  const preAuthLimiter =
    deps.preAuthLimiter ?? new RateLimiter(config.tokenRequestsPerMinutePreAuth);
  const clientKey = deps.clientKey ?? defaultClientKey;
  const mint = deps.mint ?? mintClientSecret;

  return async function handler(req: Request): Promise<Response> {
    // Pre-auth: cheap volume cap + per-IP limit — identity rotation can't
    // dodge these. The MINT budget deliberately runs after auth so that
    // unauthenticated junk can't exhaust it and lock real users out.
    if (!preAuthLimiter.allow('*') || !ipLimiter.allow(clientKey(req))) {
      return Response.json({ error: 'rate_limited' }, { status: 429 });
    }
    const grant = await deps.authorize(req);
    if (!grant) return Response.json({ error: 'unauthorized' }, { status: 401 });
    if (!userLimiter.allow(grant.userId) || !globalLimiter.allow('*')) {
      return Response.json({ error: 'rate_limited' }, { status: 429 });
    }
    try {
      const secret = await mint();
      await deps.onMint?.(grant, secret);
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
