import { stripSpeechControlTokens } from "@speedmatch/server/onboarding";
import type { Category } from "./types";

/**
 * Typed profile extracted from the onboarding conversation. This is the
 * interview UI projection of the canonical match_requests.profile.
 * Pitching agents receive only explicitly reviewed summaries, never a
 * raw transcript or an automatically shared history.
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
  requestId?: string;
  /** Extraction previews must not persist superseded voice fragments. */
  save?: boolean;
  answers: Partial<OnboardingProfile>;
  /** The user's latest utterance, answering `field`. */
  field: OnboardField | null;
  message: string;
}

export interface OnboardResponse {
  requestId?: string;
  reply: string;
  /** Which profile field the host is asking for next; null when done. */
  nextField: OnboardField | null;
  /** Chip suggestions for the next answer, when they make sense. */
  suggestions?: string[];
  done: boolean;
  answers: Partial<OnboardingProfile>;
  profile?: OnboardingProfile;
  /** Present on done. "saved" = persisted to the signed-in account;
   * "anonymous" = no session to attach to (sign in to keep it);
   * "failed" = the write blew up — retry, don't blame the user. */
  saved?: "saved" | "anonymous" | "failed";
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
