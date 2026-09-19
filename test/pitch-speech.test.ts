import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePitchLeg, pitchLine } from "../src/lib/pitchSpeech";

test("parsePitchLeg accepts round-index-side and rejects everything else", () => {
  assert.deepEqual(parsePitchLeg("0-2-A"), { round: 0, index: 2, side: "A" });
  assert.deepEqual(parsePitchLeg("12-0-B"), { round: 12, index: 0, side: "B" });
  for (const bad of [null, "", "A-0-1", "0-2-C", "0-2", "0-2-a", "1--A", "0-2-A-extra", "999-0-A"]) {
    assert.equal(parsePitchLeg(bad), null, String(bad));
  }
});

test("pitchLine sanitizes every catalog value — control tokens never reach TTS", () => {
  const line = pitchLine({
    name: "<|sfx:laughter|>Maya",
    tagline: "loves <|emotion:rage|> hiking",
    profile: { interests: ["<|pause|>chess", "sailing"] },
  });
  assert.doesNotMatch(line, /<\|/);
  assert.match(line, /Maya/);
  assert.match(line, /chess and sailing/);
});

test("pitchLine speaks the seeker's goal when the bound snapshot provides one", () => {
  const persona = { name: "Rio", tagline: "surf instructor", profile: {} };
  const withGoal = pitchLine(persona, "a <|sfx:boo|> patient climbing partner");
  assert.match(withGoal, /you're after a\s+patient climbing partner/);
  assert.doesNotMatch(withGoal, /<\|/);
  const without = pitchLine(persona, null);
  assert.doesNotMatch(without, /you're after/);
});

test("pitchLine prefers interests over hooks and works with neither", () => {
  assert.match(
    pitchLine({ name: "N", tagline: "t", profile: { hooks: ["fast", "cheap"] } }),
    /Think fast, and cheap/,
  );
  assert.match(
    pitchLine({ name: "N", tagline: "t", profile: {} }),
    /Give me your fifteen seconds/,
  );
});
