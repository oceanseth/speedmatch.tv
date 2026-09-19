import { parseOnboardingProfile } from "@speedmatch/server/onboarding";
import { query, withTransaction } from "./db";
import { MAX_PITCH_HISTORY, REQUEST_ID, reviewedRequestSummary, type MatchContext } from "./matchRequests";

/** Account lock serializes saves; immutable request IDs make retries idempotent.
 * A reused ID with different content (or another owner) is an error, never an edit. */
export async function persistMatchRequest(userId: string, id: string, value: unknown): Promise<void> {
  if (!REQUEST_ID.test(id)) throw new Error("Invalid request ID");
  const profile = parseOnboardingProfile(value);
  await withTransaction(async client => {
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
    const saved = await client.query(
      `INSERT INTO match_requests (id, user_id, profile) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id) DO NOTHING RETURNING id`, [id, userId, JSON.stringify(profile)],
    );
    if (!saved.rowCount) {
      const same = await client.query(
        "SELECT id FROM match_requests WHERE id = $1 AND user_id = $2 AND profile = $3::jsonb",
        [id, userId, JSON.stringify(profile)],
      );
      if (!same.rowCount) throw new Error("Request cannot be overwritten");
      return; // An old retry must not replace more recent account defaults.
    }
    await client.query(
      `INSERT INTO onboarding_profiles(user_id, profile, public_summary, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, now()) ON CONFLICT(user_id) DO UPDATE
       SET profile = EXCLUDED.profile, public_summary = EXCLUDED.public_summary, updated_at = now()`,
      [userId, JSON.stringify(profile), JSON.stringify({ version: 1, category: profile.category })],
    );
  });
}

export async function requestHistory(userId: string) {
  return query<{ id: string; profile: unknown; created_at: Date }>(
    "SELECT id, profile, created_at FROM match_requests WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 20",
    [userId],
  );
}

/** Called only after the authenticated owner explicitly reviews these immutable
 * records. IDs are selection, not proof of ownership; every read is owner-scoped. */
export async function approvedMatchContext(userId: string, id: string, historyIds: string[]): Promise<MatchContext | null> {
  if (!REQUEST_ID.test(id) || historyIds.length > MAX_PITCH_HISTORY ||
      historyIds.some(v => !REQUEST_ID.test(v) || v === id) || new Set(historyIds).size !== historyIds.length) return null;
  const rows = await query<{ id: string; profile: unknown }>(
    "SELECT id, profile FROM match_requests WHERE user_id = $1 AND id = ANY($2::uuid[])",
    [userId, [id, ...historyIds]],
  );
  if (rows.length !== historyIds.length + 1) return null;
  const byId = new Map(rows.map(r => [r.id, r.profile]));
  return { current: reviewedRequestSummary(byId.get(id)), history: historyIds.map(key => reviewedRequestSummary(byId.get(key))) };
}
