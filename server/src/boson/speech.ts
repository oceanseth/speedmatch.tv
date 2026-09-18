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

export function speechLine(
  strings: TemplateStringsArray,
  ...untrusted: unknown[]
): string {
  let out = strings[0];
  for (let i = 0; i < untrusted.length; i++) {
    out += sanitizeForSpeech(untrusted[i]) + strings[i + 1];
  }
  return out;
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
 * Build the body for POST https://api.boson.ai/v1/audio/speech.
 * `input` must come from `speechLine` (or be a fully trusted literal);
 * `voice` is validated against the persona catalog / registered voice ids by
 * the caller — never client-supplied free text.
 */
export function buildSpeechRequest(opts: {
  input: string;
  voice: string;
  model?: string;
}): SpeechRequestBody {
  return {
    model: opts.model ?? 'higgs-tts-3',
    input: opts.input,
    voice: opts.voice,
  };
}
