/**
 * The TTS request boundary.
 *
 * Invariant (Claude-Opus review, 2026-09-18): nothing reaches a TTS `input`
 * field without passing `stripSpeechControlTokens` AT THE CALL SITE — not
 * just at profile parse. `users.display_name`, `personas.name`, taglines,
 * chat messages: every untrusted value an orchestrator line interpolates is
 * spoken control tokens waiting to happen ("<|sfx:laughter|>" as a display
 * name plays in every match that user joins).
 *
 * `speechLine` is a tagged template that makes the safe path the easy path:
 * the LITERAL parts are the orchestrator's trusted script and may carry
 * intentional Boson delivery tags; every INTERPOLATED value is sanitized.
 *
 *   const input = speechLine`<|emotion:enthusiasm|>${name} versus ${rival} — ${name}, you're up!`;
 *   // name = '<|sfx:laughter|>Maya' → input speaks "Maya", tags gone.
 */

import { stripSpeechControlTokens } from '../onboarding/profile.ts';

declare const speechSafe: unique symbol;
/**
 * Branded string: the only values `buildSpeechRequest` accepts. Produced by
 * `speechLine` (sanitizing template) or `trustedSpeechLiteral` (fixed
 * strings). A plain string — including a raw template literal interpolating
 * user data — is a type error at the call site, not a review finding.
 */
export type SpeechSafeInput = string & { readonly [speechSafe]: true };

export function speechLine(
  strings: TemplateStringsArray,
  ...untrusted: unknown[]
): SpeechSafeInput {
  let out = strings[0];
  for (let i = 0; i < untrusted.length; i++) {
    out += sanitizeForSpeech(untrusted[i]) + strings[i + 1];
  }
  return out as SpeechSafeInput;
}

/**
 * Live-stage variant of `speechLine`: same sanitization, but instead of an
 * over-long line throwing at `buildSpeechRequest`, the INTERPOLATED values
 * are trimmed so the assembled line fits `SPEECH_INPUT_MAX` while the
 * trusted literal script stays intact. A truncated sentence is a far better
 * on-stage failure than an exception mid-tournament; keep plain `speechLine`
 * for paths where an over-long value should be treated as a bug. If the
 * literals ALONE exceed the cap (a script-authoring bug), the whole line is
 * clamped as a backstop — which can cut a trailing delivery tag, so fix the
 * script rather than relying on it.
 */
export function speechLineClamped(
  strings: TemplateStringsArray,
  ...untrusted: unknown[]
): SpeechSafeInput {
  const literalLen = strings.reduce((n, s) => n + s.length, 0);
  let budget = Math.max(0, SPEECH_INPUT_MAX - literalLen);
  let out = strings[0];
  for (let i = 0; i < untrusted.length; i++) {
    let v = sanitizeForSpeech(untrusted[i]);
    if (v.length > budget) v = v.slice(0, budget);
    budget -= v.length;
    out += v + strings[i + 1];
  }
  return out.slice(0, SPEECH_INPUT_MAX) as SpeechSafeInput;
}

/**
 * Escape hatch for genuinely fixed strings (canned show lines, config
 * constants). NEVER pass anything computed from user, chat, profile, or
 * persona data through this — that's what `speechLine` is for.
 */
export function trustedSpeechLiteral(literal: string): SpeechSafeInput {
  return literal as SpeechSafeInput;
}

/** Sanitize one untrusted value for speech. Non-strings are stringified
 * first so an object can't smuggle tags through toString(). */
export function sanitizeForSpeech(value: unknown): string {
  return stripSpeechControlTokens(String(value ?? ''));
}

export interface SpeechRequestBody {
  model: string;
  input: string;
  voice: string;
}

/**
 * TTS is the spend boundary ($/1K chars): once chat and transcripts get
 * interpolated into orchestrator lines, an unbounded input is an unbounded
 * bill. Generous for a game-show line; trim upstream if you hit it.
 */
export const SPEECH_INPUT_MAX = 2000;

/**
 * Boson preset voices (see personas.voice in migrations/001_init.sql).
 * `berlinda` is spelled per docs.boson.ai/models/higgs-tts/voices.md (twice
 * there; Opus re-verified) — included so a persona seeded with it fails at
 * seed review, not at speak time on stage.
 */
const VOICE_PRESETS = new Set([
  'chloe', 'eleanor', 'jake', 'marcus', 'nora', 'oliver', 'berlinda',
]);
/** Registered voices from POST /v1/audio/voices. */
const REGISTERED_VOICE_RE = /^voice_[A-Za-z0-9_-]+$/;

/**
 * Build the body for POST https://api.boson.ai/v1/audio/speech.
 * `input` is brand-enforced (`speechLine` / `trustedSpeechLiteral`) and
 * length-capped; `voice` is validated here against the preset catalog or the
 * registered-voice id shape — never client-supplied free text.
 */
export function buildSpeechRequest(opts: {
  input: SpeechSafeInput;
  voice: string;
  model?: string;
}): SpeechRequestBody {
  if (opts.input.length > SPEECH_INPUT_MAX) {
    throw new RangeError(
      `speech input is ${opts.input.length} chars (max ${SPEECH_INPUT_MAX}) — trim interpolated values before speaking`,
    );
  }
  if (!VOICE_PRESETS.has(opts.voice) && !REGISTERED_VOICE_RE.test(opts.voice)) {
    throw new RangeError('voice is not a preset or registered voice id');
  }
  return {
    model: opts.model ?? 'higgs-tts-3',
    input: opts.input,
    voice: opts.voice,
  };
}

export interface SynthesizeOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface SynthesizedAudio {
  audio: ArrayBuffer;
  contentType: string;
}

const TTS_URL = 'https://api.boson.ai/v1/audio/speech';

/**
 * Execute a built speech request against POST /v1/audio/speech. Taking a
 * `SpeechRequestBody` (not raw strings) keeps `buildSpeechRequest` the only
 * door: input is brand-sanitized and length-capped, voice is validated.
 */
export async function synthesizeSpeech(
  body: SpeechRequestBody,
  opts: SynthesizeOptions = {},
): Promise<SynthesizedAudio> {
  const apiKey = opts.apiKey ?? process.env.BOSON_API_KEY;
  if (!apiKey) throw new Error('BOSON_API_KEY is not set (bind it via `insta secrets set`)');
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await doFetch(TTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Deliberately not echoing the response body (same rule as the token
      // broker): upstream errors can quote request headers.
      throw new Error(`Boson speech synthesis failed: HTTP ${res.status}`);
    }
    return {
      audio: await res.arrayBuffer(),
      contentType: res.headers.get('content-type') ?? 'audio/mpeg',
    };
  } finally {
    clearTimeout(timer);
  }
}
