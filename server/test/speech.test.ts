import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeForSpeech, speechLine, buildSpeechRequest } from '../src/boson/speech.ts';

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
  const body = buildSpeechRequest({ input: 'hello', voice: 'jake' });
  assert.deepEqual(body, { model: 'higgs-tts-3', input: 'hello', voice: 'jake' });
});
