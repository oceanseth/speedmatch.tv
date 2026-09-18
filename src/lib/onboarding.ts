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

/**
 * User text is untrusted input that will eventually reach prompts and TTS.
 * Strip Boson inline control tags (<|emotion:x|> etc.), angle brackets,
 * control characters, and invisible/steering codepoints — including the
 * Unicode Tags block (U+E0000–E007F) and variation selectors, which
 * survive human review precisely because no renderer shows them.
 * Collapse whitespace; cap length. The server re-runs this on every
 * value; the client copy exists only for the character counter.
 *
 * Must stay semantically identical to the backend's
 * stripSpeechControlTokens (server/src/onboarding/profile.ts on
 * backend-skeleton). Once that package merges, import it here and delete
 * this copy — one invariant, one implementation.
 */
export function sanitizeAnswer(raw: string): string {
  return raw
    .replace(/<\|[\s\S]*?\|>/g, "")
    .replace(/[<>|]/g, "")
    .replace(
      /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufe00-\ufe0f]/g,
      " ",
    )
    .replace(/[\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ANSWER_CHARS);
}
