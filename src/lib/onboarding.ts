import { stripSpeechControlTokens } from "@speedmatch/server/onboarding";
import type { Category } from "./types";

/**
 * Typed profile extracted from the onboarding conversation. This is the
 * contract for onboarding_profiles.profile (see migrations/001_init.sql):
 * pitching agents receive a template rendered from these fields — never
 * the raw transcript.
 */
export interface OnboardingProfile {
  displayName: string;
  seeking: Category;
  lookingFor: string;
  interests: string[];
  funFact: string;
}

export type OnboardField = keyof OnboardingProfile;

export interface OnboardRequest {
  answers: Partial<OnboardingProfile>;
  /** The user's latest utterance, answering `field`. */
  field: OnboardField | null;
  message: string;
}

export interface OnboardResponse {
  reply: string;
  /** Which profile field the host is asking for next; null when done. */
  nextField: OnboardField | null;
  /** Chip suggestions for the next answer, when they make sense. */
  suggestions?: string[];
  done: boolean;
  answers: Partial<OnboardingProfile>;
  profile?: OnboardingProfile;
}

export const MAX_ANSWER_CHARS = 200;

/** Apply the shared server sanitizer before the UI's answer-length cap.
 * The API re-runs this for every incoming value; client sanitization is UX only.
 */
// Options object on purpose: an optional positional number is exactly the
// signature that breaks under `.map(sanitizeAnswer)` (the index becomes the
// cap — shipped bug). With an object, point-free use is a compile error.
export function sanitizeAnswer(
  raw: string,
  opts?: { maxChars?: number },
): string {
  return stripSpeechControlTokens(raw).slice(0, opts?.maxChars ?? MAX_ANSWER_CHARS);
}
