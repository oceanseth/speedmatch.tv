import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeForSpeech,
  speechLine,
  speechLineClamped,
  buildSpeechRequest,
  trustedSpeechLiteral,
  synthesizeSpeech,
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

test('speechLineClamped trims interpolations, keeps the literal script, and never throws downstream', () => {
  const chat = 'blah '.repeat(1000); // 5000 chars of "spectator chat"
  const line = speechLineClamped`<|emotion:calm|>The crowd says: ${chat} — and with that, a decision!`;
  assert.ok(line.length <= SPEECH_INPUT_MAX);
  assert.ok(line.startsWith('<|emotion:calm|>The crowd says: '));
  assert.ok(line.endsWith(' — and with that, a decision!'));
  // The clamped line goes straight to the boundary without throwing.
  assert.equal(buildSpeechRequest({ input: line, voice: 'jake' }).input, line);
});

test('speechLineClamped still sanitizes what it keeps', () => {
  const hostile = '<|sfx:laughter|>Maya';
  assert.equal(speechLineClamped`Welcome ${hostile}!`, 'Welcome Maya!');
});

test('speechLineClamped backstops literal-only overflow at the cap', () => {
  const strings = Object.assign(['y'.repeat(SPEECH_INPUT_MAX + 50)], {
    raw: ['y'.repeat(SPEECH_INPUT_MAX + 50)],
  }) as unknown as TemplateStringsArray;
  assert.equal(speechLineClamped(strings).length, SPEECH_INPUT_MAX);
});

test('buildSpeechRequest validates voice against presets and registered ids', () => {
  const input = trustedSpeechLiteral('hi');
  for (const ok of ['chloe', 'eleanor', 'jake', 'marcus', 'nora', 'oliver', 'berlinda', 'voice_Ab1_-x']) {
    assert.equal(buildSpeechRequest({ input, voice: ok }).voice, ok);
  }
  for (const bad of ['', 'Jake', 'voice_', 'voice_a b', 'jake; drop', '<|sfx:boo|>']) {
    assert.throws(() => buildSpeechRequest({ input, voice: bad }), RangeError, bad);
  }
});

test('synthesizeSpeech posts the built body with auth and returns the audio', async () => {
  const audio = new Uint8Array([1, 2, 3]).buffer;
  let seen: { url: string; init: RequestInit } | null = null;
  const fetchImpl = (async (url: unknown, init: unknown) => {
    seen = { url: String(url), init: init as RequestInit };
    return new Response(audio, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  }) as typeof fetch;
  const body = buildSpeechRequest({ input: trustedSpeechLiteral('hi'), voice: 'jake' });
  const out = await synthesizeSpeech(body, { apiKey: 'k', fetchImpl });
  assert.equal(out.contentType, 'audio/mpeg');
  assert.equal(new Uint8Array(out.audio).length, 3);
  assert.equal(seen!.url, 'https://api.boson.ai/v1/audio/speech');
  assert.equal((seen!.init.headers as Record<string, string>).Authorization, 'Bearer k');
  assert.deepEqual(JSON.parse(String(seen!.init.body)), body);
});

test('synthesizeSpeech surfaces only the status on upstream failure — never the body', async () => {
  const fetchImpl = (async () =>
    new Response('secret upstream detail', { status: 401 })) as typeof fetch;
  const body = buildSpeechRequest({ input: trustedSpeechLiteral('hi'), voice: 'jake' });
  await assert.rejects(
    synthesizeSpeech(body, { apiKey: 'k', fetchImpl }),
    (err: Error) => /HTTP 401/.test(err.message) && !/secret/.test(err.message),
  );
});

test('synthesizeSpeech refuses to run without an API key', async () => {
  const body = buildSpeechRequest({ input: trustedSpeechLiteral('hi'), voice: 'jake' });
  const prev = process.env.BOSON_API_KEY;
  delete process.env.BOSON_API_KEY;
  try {
    await assert.rejects(synthesizeSpeech(body, { fetchImpl: (async () => new Response()) as typeof fetch }), /BOSON_API_KEY/);
  } finally {
    if (prev !== undefined) process.env.BOSON_API_KEY = prev;
  }
});
