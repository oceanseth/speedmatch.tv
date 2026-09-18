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
