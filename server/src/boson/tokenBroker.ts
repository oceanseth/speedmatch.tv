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
  clientKey?: (req: Request, onDegraded?: (reason: DegradedKeyReason) => void) => string;
  /**
   * Alarm hook: fires when rate-limit key derivation degrades (see
   * DegradedKeyReason). Wire this to metrics/paging — if it fires in
   * production the per-IP limiter is collapsing toward a shared key.
   */
  onDegraded?: (reason: DegradedKeyReason) => void;
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
 * Cloudflare's published egress ranges (https://www.cloudflare.com/ips/).
 * Used to decide whether the immediate peer is actually Cloudflare before
 * trusting CF-Connecting-IP.
 */
const CLOUDFLARE_V4: Array<[number, number]> = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
].map((cidr) => {
  const [net, bits] = cidr.split('/');
  const [a, b, c, d] = net.split('.').map(Number);
  const base = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  const mask = bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return [base & mask, mask];
});
const CLOUDFLARE_V6_PREFIXES = [
  '2400:cb00:', '2606:4700:', '2803:f800:', '2405:b500:', '2405:8100:',
  '2c0f:f248:', '2a06:98c0:', '2a06:98c1:', '2a06:98c2:', '2a06:98c3:',
  '2a06:98c4:', '2a06:98c5:', '2a06:98c6:', '2a06:98c7:',
];

export function isCloudflareIp(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const n = ((+v4[1] << 24) | (+v4[2] << 16) | (+v4[3] << 8) | +v4[4]) >>> 0;
    return CLOUDFLARE_V4.some(([base, mask]) => (n & mask) === base);
  }
  const lower = ip.toLowerCase();
  return CLOUDFLARE_V6_PREFIXES.some((p) => lower.startsWith(p));
}

/**
 * Rate-limit key that the client cannot choose.
 *
 * Trust model: the RIGHTMOST x-forwarded-for hop is appended by the
 * InstaCloud edge in front of this container, so it is always the IP that
 * actually connected to our infrastructure — for traffic via the
 * speedmatch.tv custom domain that is a Cloudflare egress IP; for a direct
 * hit on the origin edge URL it is the attacker's own address. Only when
 * that trusted peer IS Cloudflare do we honor CF-Connecting-IP (the real
 * visitor behind CF, which CF sets and strips from clients). A direct-origin
 * attacker typing CF-Connecting-IP therefore gets keyed by their real IP —
 * the header is ignored because their peer address isn't Cloudflare's.
 */
/**
 * Reasons the key derivation degrades — each means the per-IP limiter is
 * collapsing toward one shared key. Alarm, don't ignore:
 * - 'no-peer': edge stopped appending XFF; everything keys on 'unknown'.
 * - 'cf-header-non-cf-peer': CF header behind a non-Cloudflare peer — either
 *   a direct-origin spoof attempt (keyed by the attacker's real IP, fine) or
 *   the platform inserted a hop between Cloudflare and us.
 * - 'cf-peer-no-header': peer IS Cloudflare but CF-Connecting-IP is absent —
 *   every visitor keys on a handful of CF egress IPs, so the per-IP mint cap
 *   becomes a near-global cap. This is the outage case.
 * Empirically verified 2026-09-18 on InstaCloud: BOTH ingress paths (custom
 * domain and the compute edge URL) transit Cloudflare workers, client-typed
 * XFF is stripped wholesale (rightmost hop is always a CF egress IP), and
 * spoofed CF-Connecting-IP is rejected by Cloudflare with error 1000 — so
 * none of these should fire until the platform changes underneath us.
 */
export type DegradedKeyReason = 'no-peer' | 'cf-header-non-cf-peer' | 'cf-peer-no-header';
const DEGRADED_WARN_WINDOW_MS = 60_000;
let lastDegradedWarnAt = -Infinity;

export function defaultClientKey(
  req: Request,
  onDegraded?: (reason: DegradedKeyReason) => void,
): string {
  const hops = req.headers.get('x-forwarded-for')?.split(',') ?? [];
  const peer = hops.at(-1)?.trim() || '';
  const cf = req.headers.get('cf-connecting-ip');
  if (cf && peer && isCloudflareIp(peer)) return cf.trim();
  const reason: DegradedKeyReason | null = !peer
    ? 'no-peer'
    : cf
      ? 'cf-header-non-cf-peer'
      : isCloudflareIp(peer)
        ? 'cf-peer-no-header'
        : null; // non-CF peer, no CF header: normal direct-origin keying
  if (reason) {
    onDegraded?.(reason);
    // Windowed, not one-shot: a transient at boot must not permanently
    // silence a later real degradation.
    const now = Date.now();
    if (now - lastDegradedWarnAt >= DEGRADED_WARN_WINDOW_MS) {
      lastDegradedWarnAt = now;
      console.warn(
        `[tokenBroker] degraded rate-limit key (${reason}) — per-IP limiting may be collapsing to a shared key; check edge XFF behavior`,
      );
    }
  }
  return peer || 'unknown';
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
    if (!preAuthLimiter.allow('*') || !ipLimiter.allow(clientKey(req, deps.onDegraded))) {
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
