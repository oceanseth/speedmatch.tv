import { buildPublicSummary, parseOnboardingProfile, type PublicSummary } from "@speedmatch/server/onboarding";
import type { OnboardingProfile } from "./onboarding";

export const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_PITCH_HISTORY = 3;
export interface MatchRequest {
  id: string;
  createdAt: string;
  profile: OnboardingProfile;
}
export interface MatchContext {
  current: PublicSummary;
  history: PublicSummary[];
}
/** Only values displayed in the interview/history review can be approved.
 * Orchestrator-only preferences/dealbreakers and identity stay private. */
export function reviewedRequestSummary(value: unknown): PublicSummary {
  const profile = parseOnboardingProfile(value);
  return buildPublicSummary({ ...profile, preferences: profile.preferences.slice(0, 1) }, ["goal", "interests", "preferences"]);
}
