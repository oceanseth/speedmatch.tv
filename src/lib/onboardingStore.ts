import "server-only";
import {
  parseOnboardingProfile,
  buildPublicSummary,
} from "@speedmatch/server/onboarding";
import { query } from "./db";
import { getAppUser } from "./identity";
import type { OnboardingProfile as AppProfile } from "./onboarding";
import type { Category } from "./types";

/**
 * SOURCE OF TRUTH RULING (from the #23 review): the CANONICAL server-package
 * shape stored in onboarding_profiles.profile is authoritative
 * (version/category/goal/interests/preferences/dealbreakers) — the app's
 * conversational shape (displayName/seeking/lookingFor/interests/funFact)
 * is a projection for the interview UI. Mapping: seeking→category,
 * lookingFor→goal, funFact→preferences[0]. displayName is NOT stored here —
 * it lives on the account (users.display_name, already sanitized).
 *
 * The interview therefore only overwrites the fields it owns: on re-save,
 * existing dealbreakers and preferences beyond slot 0 (the orchestrator's
 * future territory) are preserved, not clobbered.
 */

// The canonical contract caps interests/preferences ITEMS at 120 chars while
// the app caps whole answers at 200 — and its validator throws rather than
// trims. A signed-in user's perfectly normal 130-char fun fact must save its
// first 120 chars, not blow up the write (Seth would hit this on his first
// retest).
const CANONICAL_ITEM_MAX = 120;
const clip = (s: string) => s.slice(0, CANONICAL_ITEM_MAX);

export function toCanonicalProfile(p: AppProfile) {
  return parseOnboardingProfile({
    version: 1,
    category: p.seeking,
    goal: p.lookingFor,
    interests: p.interests.map(clip),
    preferences: p.funFact ? [clip(p.funFact)] : [],
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

export type SaveResult = "saved" | "anonymous";

/**
 * Persist a completed interview for the signed-in account; "anonymous" when
 * there is no session (nothing to attach to). Failures THROW — the caller
 * distinguishes "failed" from "anonymous" so the UI never tells a signed-in
 * user to sign in when the write actually blew up.
 * public_summary stays header-only until the user explicitly approves
 * fields (the "ready to open the bracket?" yes belongs to the orchestrator
 * flow) — buildPublicSummary with no approved fields is the safe default.
 */
export async function saveProfile(
  headers: Headers,
  profile: AppProfile,
): Promise<SaveResult> {
  const user = await getAppUser(headers);
  if (!user) return "anonymous";
  let canonical = toCanonicalProfile(profile);

  // Preserve orchestrator-owned fields on re-save (see ruling above).
  const existing = await query<{ profile: unknown }>(
    `SELECT profile FROM onboarding_profiles WHERE user_id = $1`,
    [user.id],
  );
  if (existing.length > 0) {
    try {
      const prev = parseOnboardingProfile(existing[0].profile);
      // Clamp the merge to the canonical max (8): keep the user's fresh
      // answer (slot 0) and the NEWEST orchestrator entries, dropping the
      // oldest — a full profile must never turn a legitimate re-interview
      // into a "failed" save.
      const keep = 8 - canonical.preferences.length;
      canonical = parseOnboardingProfile({
        ...canonical,
        preferences: [
          ...canonical.preferences,
          ...prev.preferences.slice(1).slice(-keep),
        ],
        dealbreakers: prev.dealbreakers,
      });
    } catch {
      // Unreadable stored profile: the fresh interview simply replaces it.
    }
  }

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
  return "saved";
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
