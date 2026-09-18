// Server-only by placement (imported solely from route handlers); the
// "server-only" poison import is omitted so the node test runner can load
// the route module (Next aliases that package; plain node cannot).
import {
  parseOnboardingProfile,
  buildPublicSummary,
} from "@speedmatch/server/onboarding";
import { query } from "./db";
import { getAppUser } from "./identity";
import type { OnboardingProfile as AppProfile } from "./onboarding";
import type { Category } from "./types";

/**
 * Two profile shapes exist by design: the app's conversational shape
 * (displayName/seeking/lookingFor/interests/funFact) and the server
 * package's canonical contract for onboarding_profiles.profile
 * (version/category/goal/interests/preferences/dealbreakers), which is what
 * the orchestrator's pitch context consumes. Mapping: seeking→category,
 * lookingFor→goal, funFact→preferences[0]. displayName is NOT stored here —
 * it lives on the account (users.display_name, already sanitized).
 */
export function toCanonicalProfile(p: AppProfile) {
  return parseOnboardingProfile({
    version: 1,
    category: p.seeking,
    goal: p.lookingFor,
    interests: p.interests,
    preferences: p.funFact ? [p.funFact] : [],
    dealbreakers: [],
  });
}

export function toAppProfile(
  canonical: unknown,
  displayName: string,
): AppProfile | null {
  try {
    const c = parseOnboardingProfile(canonical);
    return {
      displayName,
      seeking: c.category as Category,
      lookingFor: c.goal,
      interests: [...c.interests],
      funFact: c.preferences[0] ?? "",
    };
  } catch {
    return null;
  }
}

/**
 * Persist a completed profile for the signed-in account. Anonymous sessions
 * return false — nothing to attach to, and the client says so honestly.
 * public_summary stays header-only until the user explicitly approves
 * fields (the "ready to open the bracket?" yes belongs to the orchestrator
 * flow) — buildPublicSummary with no approved fields is the safe default.
 */
export async function saveProfile(
  headers: Headers,
  profile: AppProfile,
): Promise<boolean> {
  const user = await getAppUser(headers);
  if (!user) return false;
  const canonical = toCanonicalProfile(profile);
  const summary = buildPublicSummary(canonical, []);
  await query(
    `INSERT INTO onboarding_profiles (user_id, profile, public_summary, updated_at)
     VALUES ($1, $2::jsonb, $3::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE
       SET profile = EXCLUDED.profile,
           public_summary = EXCLUDED.public_summary,
           updated_at = now()`,
    [user.id, JSON.stringify(canonical), JSON.stringify(summary)],
  );
  return true;
}

export async function loadProfile(headers: Headers): Promise<AppProfile | null> {
  const user = await getAppUser(headers);
  if (!user) return null;
  const rows = await query<{ profile: unknown }>(
    `SELECT profile FROM onboarding_profiles WHERE user_id = $1`,
    [user.id],
  );
  if (rows.length === 0) return null;
  return toAppProfile(rows[0].profile, user.displayName);
}
