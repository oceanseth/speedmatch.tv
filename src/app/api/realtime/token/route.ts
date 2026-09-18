import {
  createTokenBrokerHandler,
  type MintGrant,
} from "@speedmatch/server/boson";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sessionIdFrom(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const sid = cookie.match(/(?:^|;\s*)sm_sid=([^;]+)/)?.[1];
  return sid && UUID_RE.test(sid) ? sid : null;
}

/**
 * v1 authorize: requires the sm_sid session cookie (GET /api/session first).
 * `tournamentId` defaults to "lobby" — the gate-1 mic test has no tournament
 * yet. The broker's per-session (120/min), per-IP (20/min), and global mint
 * budgets are the spend guard.
 *
 * TODO(ownership): when tournament create lands, authorize reads the Better
 * Auth session FIRST and falls back to sm_sid only for anonymous lobby —
 * otherwise the rotatable cookie stays the thing gating spend (Opus, #18
 * review). Non-lobby tournamentId must be verified against the tournament's
 * owner AND a phase where the owner may speak; spectators are refused.
 * Identity mapping decision: users gains `auth_user_id text unique`
 * referencing Better Auth's "user".id — tournaments.user_id stays uuid.
 */
async function authorize(req: Request): Promise<MintGrant | null> {
  const sid = sessionIdFrom(req);
  if (!sid) return null;
  let tournamentId = "lobby";
  try {
    const body: unknown = await req.json();
    const t = (body as { tournamentId?: unknown })?.tournamentId;
    if (typeof t === "string" && t.length <= 64) tournamentId = t;
  } catch {
    // No/invalid JSON body is fine — lobby mint.
  }
  return { userId: sid, tournamentId };
}

export const POST = createTokenBrokerHandler({
  authorize,
  onDegraded: (reason) =>
    console.error(`[realtime/token] degraded rate-limit key: ${reason}`),
  // TODO(audit): append TOKEN_MINTED to session_events once non-lobby
  // tournaments exist; lobby mints only reach the process log.
  onMint: async (grant: MintGrant) => {
    console.log(
      `[realtime/token] TOKEN_MINTED user=${grant.userId} tournament=${grant.tournamentId}`,
    );
  },
});
