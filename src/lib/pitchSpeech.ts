import {
  speechLineClamped,
  type SpeechSafeInput,
} from "@speedmatch/server/speech";

/**
 * Composes the spoken 15-second pitch for a persona, in the persona's OWN
 * voice (first person) — distinct from the host cue the events feed carries.
 * Server-only by placement: routes import it; nothing client-side does.
 *
 * Literals are the trusted script; every catalog value (name, tagline,
 * profile hooks) is sanitized + clamped by `speechLineClamped` on
 * interpolation, per the TTS boundary invariant in server/src/boson/speech.ts.
 */

export interface PitchPersona {
  name: string;
  tagline: string;
  /** personas.profile jsonb — shape varies by category, treated as untrusted. */
  profile: unknown;
}

/** A pitch leg address inside the bracket: rounds[round][index], side A|B. */
export interface PitchLeg {
  round: number;
  index: number;
  side: "A" | "B";
}

const LEG_RE = /^(\d{1,2})-(\d{1,2})-(A|B)$/;

/** Parse the `leg` query param (`<round>-<index>-<A|B>`); null if malformed. */
export function parsePitchLeg(raw: string | null): PitchLeg | null {
  const m = raw ? LEG_RE.exec(raw) : null;
  if (!m) return null;
  return { round: Number(m[1]), index: Number(m[2]), side: m[3] as "A" | "B" };
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string").slice(0, max);
}

/**
 * The seeker's stated goal from the tournament's reviewed match_context
 * snapshot (migration 008). Server-parsed `PublicSummary` values only —
 * still interpolated (sanitized + clamped), never trusted as script.
 */
export function pitchLine(
  persona: PitchPersona,
  seekerGoal: string | null = null,
): SpeechSafeInput {
  const profile =
    persona.profile && typeof persona.profile === "object"
      ? (persona.profile as Record<string, unknown>)
      : {};
  // People carry `interests`, products and places carry `hooks`; either way
  // two items keep the line inside a 15-second read.
  const interests = stringList(profile.interests, 2);
  const hooks = stringList(profile.hooks, 2);
  const flavor =
    interests.length > 0
      ? ` — and I'm really into ${interests.join(" and ")}`
      : hooks.length > 0
        ? `. Think ${hooks.join(", and ")}`
        : "";
  if (seekerGoal) {
    return speechLineClamped`Hi, I'm ${persona.name}. You said you're after ${seekerGoal} — well, ${persona.tagline}${flavor}. Give me your fifteen seconds and pick me!`;
  }
  return speechLineClamped`Hi, I'm ${persona.name}. ${persona.tagline}${flavor}. Give me your fifteen seconds and pick me!`;
}
