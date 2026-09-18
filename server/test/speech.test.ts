import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeForSpeech,
  speechLine,
  buildSpeechRequest,
  trustedSpeechLiteral,
  SPEECH_INPUT_MAX,
} from '../src/boson/speech.ts';

test('speechLine keeps trusted literals (incl. delivery tags), sanitizes interpolations', () => {
  const name = '<|sfx:laughter|>Maya';
  const rival = 'Dev<|emotion:rage|>';
  const line = speechLine`<|emotion:enthusiasm|>${name} versus ${rival} — ${name}, you're up!`;
  assert.equal(line, `<|emotion:enthusiasm|>Maya versus Dev — Maya, you're up!`);
});

test('interpolated bare delimiters and invisible characters are stripped', () => {
  const hostile = 'Ma|ya <|unfinished \u{E0041}‮hidden';
  const line = speechLine`Welcome ${hostile}!`;
  assert.ok(!/[<>|]/.test(line.replace('Welcome', '').replace('!', '')));
  assert.ok(!line.includes('‮'));
  assert.ok(!line.includes('\u{E0041}'));
});

test('non-string interpolations cannot smuggle tags via toString', () => {
  const sneaky = { toString: () => '<|sfx:applause|>boo' };
  assert.equal(speechLine`crowd goes ${sneaky}`, 'crowd goes boo');
  assert.equal(sanitizeForSpeech(null), '');
  assert.equal(sanitizeForSpeech(42), '42');
});

test('buildSpeechRequest defaults the model and passes input through untouched', () => {
  const body = buildSpeechRequest({ input: trustedSpeechLiteral('hello'), voice: 'jake' });
  assert.deepEqual(body, { model: 'higgs-tts-3', input: 'hello', voice: 'jake' });
});

test('buildSpeechRequest only compiles for brand-safe input', () => {
  // @ts-expect-error plain strings must not reach the TTS boundary — only
  // speechLine / trustedSpeechLiteral output does. (Runtime passes; the
  // brand is compile-time enforcement, asserted by `npm run typecheck`.)
  const body = buildSpeechRequest({ input: 'raw ' + 'string', voice: 'jake' });
  assert.equal(body.input, 'raw string');
});

test('buildSpeechRequest caps input length — the TTS spend boundary', () => {
  const long = trustedSpeechLiteral('x'.repeat(SPEECH_INPUT_MAX + 1));
  assert.throws(() => buildSpeechRequest({ input: long, voice: 'jake' }), RangeError);
  const exact = trustedSpeechLiteral('x'.repeat(SPEECH_INPUT_MAX));
  assert.equal(buildSpeechRequest({ input: exact, voice: 'jake' }).input.length, SPEECH_INPUT_MAX);
});

test('buildSpeechRequest validates voice against presets and registered ids', () => {
  const input = trustedSpeechLiteral('hi');
  for (const ok of ['chloe', 'eleanor', 'jake', 'marcus', 'nora', 'oliver', 'voice_Ab1_-x']) {
    assert.equal(buildSpeechRequest({ input, voice: ok }).voice, ok);
  }
  for (const bad of ['', 'Jake', 'voice_', 'voice_a b', 'jake; drop', '<|sfx:boo|>']) {
    assert.throws(() => buildSpeechRequest({ input, voice: bad }), RangeError, bad);
  }
});
