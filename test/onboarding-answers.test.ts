import { test } from "node:test";
import assert from "node:assert/strict";
import { OnboardingAnswers, type InterviewQuestion } from "../src/lib/onboardingAnswers";

const question: InterviewQuestion = { id: "q1", field: "lookingFor", answers: { displayName: "David", seeking: "products" } };

test("speech fragments merge against the question's original profile, not successive fields", () => {
  const buffer = new OnboardingAnswers();
  const first = buffer.add(question, "A bicycle")!;
  assert.equal(first.current(), true);
  const continuation = buffer.add(question, "for long distance commuting")!;
  assert.equal(first.current(), false, "in-flight response must not publish after more speech arrives");
  assert.deepEqual(continuation.request(), { answers: question.answers, field: "lookingFor", message: "A bicycle for long distance commuting" });
  assert.equal(continuation.current(), true);
});

test("duplicate finalized items with different IDs cannot fill another field", () => {
  const buffer = new OnboardingAnswers();
  const first = buffer.add(question, "The best.")!;
  assert.equal(buffer.add(question, "THE best!"), null);
  assert.equal(first.current(), true);
  assert.equal(first.request().message, "The best.");
});

test("new questions invalidate prior results and start a fresh answer", () => {
  const buffer = new OnboardingAnswers();
  const old = buffer.add(question, "A bicycle")!;
  const next = buffer.add({ ...question, id: "q2", field: "interests", answers: { ...question.answers, lookingFor: "A bicycle" } }, "cycling")!;
  assert.equal(old.current(), false);
  assert.equal(next.request().field, "interests");
  assert.equal(next.request().message, "cycling");
  assert.equal(next.request().answers.lookingFor, "A bicycle");
});

test("a failed submission can reset and accept the same answer again", () => {
  const buffer = new OnboardingAnswers();
  const first = buffer.add(question, "A bicycle")!;
  buffer.reset();
  assert.equal(first.current(), false);
  assert.ok(buffer.add(question, "A bicycle"));
});

test("a single question cannot accumulate an unbounded transcript", () => {
  const buffer = new OnboardingAnswers();
  assert.equal(buffer.add(question, "..."), null);
  const first = buffer.add(question, "x".repeat(1999))!;
  assert.equal(buffer.add(question, "another fragment"), null);
  assert.equal(first.current(), true);
  assert.ok(first.request().message.length <= 2000);
});
