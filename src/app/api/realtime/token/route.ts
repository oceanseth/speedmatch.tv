import {
  createTokenBrokerHandler,
  type MintGrant,
} from "@speedmatch/server/boson";
import { getAppUser } from "../../../../lib/identity";
import { query } from "../../../../lib/db";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sessionIdFrom(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const sid = cookie.match(/(?:^|;\s*)sm_sid=([^;]+)/)?.[1];
  return sid && UUID_RE.test(sid) ? sid : null;
}

/**
 * Ownership authorize (Opus #13/#18 review checklist):
 * - The Better Auth session is read FIRST; the rotatable anonymous sm_sid
 *   cookie only authorizes "lobby" mints (the /session/new voice preview).
 * - A non-lobby tournamentId must belong to the signed-in account
 *   (tournaments.user_id via users.auth_user_id) and be in a phase where
 *   the owner may speak — FINAL/ABANDONED refuse. Spectators and
 *   non-owners get the same opaque 401 as an unknown id (no oracle).
 * - The broker's per-user/per-IP/global budgets remain the spend guard.
 */
async function authorize(req: Request): Promise<MintGrant | null> {
  const appUser = await getAppUser(req.headers);
  let tournamentId = "lobby";
  try {
    const body: unknown = await req.json();
    const t = (body as { tournamentId?: unknown })?.tournamentId;
    if (typeof t === "string" && t.length <= 64) tournamentId = t;
  } catch {
    // No/invalid JSON body is fine — lobby mint.
  }

  if (tournamentId === "lobby") {
    const anonId = appUser?.id ?? sessionIdFrom(req);
    return anonId ? { userId: anonId, tournamentId: "lobby" } : null;
  }

  if (!appUser || !UUID_RE.test(tournamentId)) return null;
  const rows = await query<{ phase: string }>(
    `SELECT phase FROM tournaments WHERE id = $1 AND user_id = $2`,
    [tournamentId, appUser.id],
  );
  if (rows.length === 0) return null;
  if (rows[0].phase === "FINAL" || rows[0].phase === "ABANDONED") return null;
  return { userId: appUser.id, tournamentId };
}

export const POST = createTokenBrokerHandler({
  authorize,
  onDegraded: (reason) =>
    console.error(`[realtime/token] degraded rate-limit key: ${reason}`),
  onMint: async (grant: MintGrant) => {
    if (grant.tournamentId === "lobby") {
      console.log(`[realtime/token] TOKEN_MINTED (lobby) user=${grant.userId}`);
      return;
    }
    // The event log owns its own sequence: tournaments.version is the
    // optimistic-concurrency token and must move ONLY when state changes —
    // an audit append bumping it would invalidate an in-flight transition
    // (Opus, #20 review). The (tournament_id, seq) PK serializes concurrent
    // appends; on a conflict we retry, and after that we drop the audit row
    // rather than fail a mint that already succeeded.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await query(
          `INSERT INTO session_events (tournament_id, seq, type, payload)
           SELECT $1, COALESCE(MAX(seq), 0) + 1, 'TOKEN_MINTED', $2::jsonb
           FROM session_events WHERE tournament_id = $1`,
          [grant.tournamentId, JSON.stringify({ userId: grant.userId })],
        );
        return;
      } catch (err) {
        if ((err as { code?: string }).code !== "23505") throw err;
      }
    }
    console.error(
      `[realtime/token] TOKEN_MINTED audit dropped after seq conflicts tournament=${grant.tournamentId}`,
    );
  },
});
