import { auth } from "./auth";
import { query } from "./db";

export interface AppUser {
  /** users.id (uuid) — what tournaments.user_id references. */
  id: string;
  /** Better Auth "user".id (text). */
  authUserId: string;
  displayName: string;
}

/**
 * Resolve the Better Auth session from request headers and find-or-create
 * the app users row for it (users.auth_user_id mapping, migration 006).
 * Returns null when there is no authenticated session. The display name was
 * already sanitized by the auth databaseHooks — this stores what auth holds.
 */
export async function getAppUser(headers: Headers): Promise<AppUser | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const { id: authUserId, name } = session.user;
  // Read-first: this runs on every authorized request (including token
  // mints), and an unconditional upsert would leave a dead tuple per call.
  const found = await query<{ id: string; display_name: string }>(
    `SELECT id, display_name FROM users WHERE auth_user_id = $1`,
    [authUserId],
  );
  if (found.length > 0 && found[0].display_name === name) {
    return { id: found[0].id, authUserId, displayName: found[0].display_name };
  }
  const rows = await query<{ id: string; display_name: string }>(
    `INSERT INTO users (display_name, auth_user_id)
     VALUES ($2, $1)
     ON CONFLICT (auth_user_id)
       DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id, display_name`,
    [authUserId, name],
  );
  return { id: rows[0].id, authUserId, displayName: rows[0].display_name };
}
