import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeAnswer, MAX_ANSWER_CHARS } from "../src/lib/onboarding";
import { POST } from "../src/app/api/onboard/route";

async function onboard(body: unknown) {
  return POST(new Request("http://localhost/api/onboard", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
}
test("onboarding drops Unicode-obfuscated tags before matching and preserves answer cap", () => {
  assert.equal(sanitizeAnswer("<\u{E0100}|emotion:secret|>Alex"), "Alex");
  assert.equal(sanitizeAnswer("hello|world"), "hello world");
  assert.equal(sanitizeAnswer("x".repeat(300)).length, MAX_ANSWER_CHARS);
});
test("route re-sanitizes existing answers and current message, keeps name cap", async () => {
  const response = await onboard({ answers: { displayName: "<\u{E0100}|sfx:secret|>" + "a".repeat(70) }, field: "lookingFor", message: "<|sfx:noise|>A quiet cafe" });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.answers.displayName, "a".repeat(40));
  assert.equal(result.answers.lookingFor, "A quiet cafe");
  assert.equal(result.reply.includes("secret"), false);
});
test("full scripted onboarding still completes through the shared sanitizer", async () => {
  let answers = {};
  const steps = [["displayName", "Alex"], ["seeking", "a person"], ["lookingFor", "A cycling buddy"], ["interests", "cycling, coffee"], ["funFact", "I repair bikes"]];
  let result;
  for (const [field, message] of steps) {
    const response = await onboard({ answers, field, message });
    assert.equal(response.status, 200);
    result = await response.json(); answers = result.answers;
  }
  assert.equal(result.done, true);
  assert.equal(result.profile.seeking, "people");
  assert.deepEqual(result.profile.interests, ["cycling", "coffee"]);
});
test("body limit and empty-interest re-ask survive sanitizer consolidation", async () => {
  assert.equal((await onboard({ message: "😀".repeat(3000) })).status, 413);
  const response = await onboard({ answers: { displayName: "Alex", seeking: "people", lookingFor: "A friend" }, field: "interests", message: "," });
  assert.equal((await response.json()).nextField, "interests");
});

test("one utterance fills several missing fields (fast interview)", async () => {
  const response = await onboard({
    answers: {},
    field: "displayName",
    message: "I'm David and I want a hiking buddy for the weekends, a person ideally",
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.answers.displayName, "David");
  assert.equal(result.answers.seeking, "people");
  assert.ok(result.answers.lookingFor.includes("hiking buddy"));
  assert.equal(result.nextField, "interests");
});

test("a plain one-word name still passes through the name question", async () => {
  const result = await (await onboard({ answers: {}, field: "displayName", message: "David" })).json();
  assert.equal(result.answers.displayName, "David");
});

test("'I'm looking for...' never becomes a display name", async () => {
  const result = await (
    await onboard({ answers: {}, field: "seeking", message: "I'm looking for somewhere sunny" })
  ).json();
  assert.equal(result.answers.displayName, undefined);
  assert.equal(result.answers.seeking, "places");
  assert.ok(result.answers.lookingFor.includes("somewhere sunny"));
});

test("David's regression profile: control phrases and vagueness never become facts", async () => {
  const base = { displayName: "David", seeking: "products" };
  // "The best." must not become lookingFor — focused re-ask instead.
  let r = await (await onboard({ answers: base, field: "lookingFor", message: "The best." })).json();
  assert.equal(r.answers.lookingFor, undefined);
  assert.equal(r.nextField, "lookingFor");
  assert.ok(/best how/i.test(r.reply));
  // Talking to the host must not become a fun fact.
  const full = { ...base, lookingFor: "a fast espresso grinder", interests: ["coffee"] };
  r = await (await onboard({
    answers: full, field: "funFact",
    message: "Let me speak. You, you, you should, you should wait until I answer.",
  })).json();
  assert.equal(r.answers.funFact, undefined);
  assert.equal(r.nextField, "funFact");
  // A repeated fragment must not fill a second field.
  r = await (await onboard({ answers: full, field: "funFact", message: "a fast espresso grinder" })).json();
  assert.equal(r.answers.funFact, undefined);
  assert.equal(r.nextField, "funFact");
});

test("Opus #26 fixtures: category answers, self-descriptions, and mid-sentence 'stop'", async () => {
  // "I want a person" answers the category question and must NOT poison lookingFor.
  let r = await (await onboard({ answers: { displayName: "David" }, field: "seeking", message: "I want a person" })).json();
  assert.equal(r.answers.seeking, "people");
  assert.equal(r.answers.lookingFor, undefined);
  // "I'm a designer looking for investors" is a self-description, not a name.
  r = await (await onboard({ answers: {}, field: "seeking", message: "I'm a designer looking for investors, a person" })).json();
  assert.equal(r.answers.displayName, undefined);
  assert.ok(r.answers.lookingFor.includes("investors"));
  // A real answer containing "stop" must not be deflected as a control phrase.
  const base = { displayName: "Seth", seeking: "places" };
  r = await (await onboard({ answers: base, field: "lookingFor", message: "somewhere I can stop and think" })).json();
  assert.equal(r.answers.lookingFor, "somewhere I can stop and think");
});

test("declaratively framed answers are never control phrases", async () => {
  const base = { displayName: "Seth", seeking: "products" };
  const r = await (await onboard({ answers: base, field: "lookingFor", message: "I want to slow down" })).json();
  assert.equal(r.answers.lookingFor, "I want to slow down");
});

test("article-led stalls are control; 'a moment, please' matches (Opus correction)", async () => {
  const base = { displayName: "Seth", seeking: "places" };
  let r = await (await onboard({ answers: base, field: "lookingFor", message: "a sec, hold on" })).json();
  assert.equal(r.answers.lookingFor, undefined);
  r = await (await onboard({ answers: base, field: "lookingFor", message: "a moment, please" })).json();
  assert.equal(r.answers.lookingFor, undefined);
  r = await (await onboard({ answers: base, field: "lookingFor", message: "a place where I can stop and think" })).json();
  assert.equal(r.answers.lookingFor, "a place where I can stop and think");
});
