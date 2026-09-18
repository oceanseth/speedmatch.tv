import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePublicShow, parsePublicReplay, publicText, validTournamentId } from "../src/lib/public-replays";

const a = { id: "a", name: "Maya", avatar: { kind: "emoji", value: "🚴" } };
const b = { id: "b", name: "Theo", avatar: { kind: "stream", value: "https://untrusted.example/video" } };
export const show = {
  id: "show-1", category: "people", bracketSize: 4, isPublic: true, phase: "FINAL",
  summaryTitle: "The Cyclist Who Out-Pitched Everyone", winner: a,
  createdAt: "2026-09-18T12:00:00Z", finishedAt: "2026-09-18T12:09:00Z",
  matches: [
    { id: "m3", round: 1, matchIndex: 0, entrantA: a, entrantB: b, winnerId: "a", decidedAt: "2026-09-18T12:09:00Z" },
    { id: "m2", round: 0, matchIndex: 1, entrantA: a, entrantB: b, winnerId: "b", decidedAt: "2026-09-18T12:06:00Z" },
    { id: "m1", round: 0, matchIndex: 0, entrantA: a, entrantB: b, winnerId: "a", decidedAt: "2026-09-18T12:03:00Z" },
  ],
};
test("only explicitly public, finished FINAL tournaments pass the public boundary", () => {
  for (const patch of [{ isPublic: false }, { isPublic: undefined }, { phase: "ABANDONED" }, { phase: "PITCH_A" }, { finishedAt: null }]) {
    assert.equal(parsePublicShow({ ...show, ...patch }), null);
    assert.equal(parsePublicReplay({ ...show, ...patch }), null);
  }
});
test("shared sanitizer covers headlines, winner and both entrants, including Unicode-obfuscated tags", () => {
  const name = "<\u{E0100}|emotion:secret|>Maya\u202e";
  const dirty = { ...a, name };
  const parsed = parsePublicReplay({ ...show, summaryTitle: name, winner: dirty, matches: [{ ...show.matches[0], entrantA: dirty, entrantB: { ...b, name } }] })!;
  assert.equal(parsed.summaryTitle, "Maya");
  assert.equal(parsed.winner!.name, "Maya");
  assert.equal(parsed.matches[0].entrantA.name, "Maya");
  assert.equal(parsed.matches[0].entrantB.name, "Maya");
  assert.equal(publicText("<|sfx:x|>", "Fallback"), "Fallback");
});
test("uses denormalized matches rows, sorts round and matchIndex, ignores state", () => {
  const parsed = parsePublicReplay({ ...show, state: { rounds: [{ secret: "never render" }] }, user: { email: "private@example.com" } })!;
  assert.deepEqual(parsed.matches.map(m => m.id), ["m1", "m2", "m3"]);
  assert.equal("state" in parsed, false);
  assert.equal("user" in parsed, false);
});
test("external avatar hosts require explicit allowlisting; streams are placeholders", () => {
  const withAvatar = (value: string) => ({ ...show, winner: { ...a, avatar: { kind: "image", value } } });
  for (const source of ["https://tracker.example/pixel", "//tracker.example/pixel", "/\\tracker.example/pixel", "javascript:alert(1)"]) {
    assert.equal(parsePublicShow(withAvatar(source))!.winner!.avatar.kind, "emoji");
  }
  assert.equal(parsePublicShow(withAvatar("https://images.example/a.png"), ["images.example"])!.winner!.avatar.kind, "image");
  assert.equal(parsePublicShow(withAvatar("/avatars/a.png"))!.winner!.avatar.kind, "image");
  assert.deepEqual(parsePublicShow({ ...show, winner: b })!.winner!.avatar, { kind: "stream", value: "" });
});
test("invalid row data cannot invent a winner or corrupt the bracket", () => {
  for (const patch of [{ winnerId: "outsider" }, { round: 12 }, { matchIndex: 42 }, { round: -1 }]) {
    assert.throws(() => parsePublicReplay({ ...show, matches: [{ ...show.matches[0], ...patch }] }));
  }
  assert.throws(() => parsePublicReplay({ ...show, matches: [show.matches[0], show.matches[0]] }));
  assert.throws(() => parsePublicShow({ ...show, finishedAt: "invalid" }));
  assert.throws(() => parsePublicShow({ ...show, bracketSize: 5 }));
  assert.throws(() => parsePublicReplay({ ...show, matches: undefined }));
});
test("null winners and empty matches stay honest; route identifiers cannot traverse paths", () => {
  assert.equal(parsePublicReplay({ ...show, winner: null, matches: [] })!.winner, null);
  for (const value of ["../private", "..", "x/y", "%2f", "", "a".repeat(129)]) assert.equal(validTournamentId(value), false);
  assert.equal(validTournamentId("efb2a69e-4df7-43d2-b69a-52493a900688"), true);
});
