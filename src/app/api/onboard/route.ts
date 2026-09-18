import { NextResponse } from "next/server";
import {
  sanitizeAnswer,
  type OnboardField,
  type OnboardRequest,
  type OnboardResponse,
  type OnboardingProfile,
} from "../../../lib/onboarding";
import type { Category } from "../../../lib/types";

export const dynamic = "force-dynamic";

// Scripted host flow, stateless per request: the client holds the answers
// collected so far, the server decides the next question and sanitizes
// every user-supplied value. Swaps for the Higgs Realtime conversation
// later without changing the page.
const ORDER: OnboardField[] = [
  "displayName",
  "seeking",
  "lookingFor",
  "interests",
  "funFact",
];

const CATEGORIES: Category[] = ["people", "products", "places"];

function questionFor(
  field: OnboardField,
  answers: Partial<OnboardingProfile>,
): { reply: string; suggestions?: string[] } {
  const name = answers.displayName ?? "there";
  switch (field) {
    case "displayName":
      return {
        reply:
          "Hey! I'm your host — I'll run your matches and keep everyone honest on the clock. Before we start: what should I call you?",
      };
    case "seeking":
      return {
        reply: `Nice to meet you, ${name}. What kind of match are we hunting for today — a person, a product, or a place?`,
        suggestions: ["People", "Products", "Places"],
      };
    case "lookingFor":
      return {
        reply:
          "Got it. Tell me in a sentence what you're actually looking for — the contestants will hear a summary of this, so make it count.",
      };
    case "interests":
      return {
        reply:
          "What are two or three things you're into right now? Comma-separated is fine — this helps contestants pitch to you, not at you.",
      };
    case "funFact":
      return {
        reply:
          "Last one: give me a fun fact about you. The good pitches will pick up on it.",
      };
  }
}

function nextMissing(answers: Partial<OnboardingProfile>): OnboardField | null {
  for (const f of ORDER) {
    if (answers[f] === undefined) return f;
  }
  return null;
}

export async function POST(req: Request) {
  let body: OnboardRequest;
  try {
    body = (await req.json()) as OnboardRequest;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  // Re-sanitize everything the client sent; the client's copy is a
  // convenience, never a trusted value.
  const answers: Partial<OnboardingProfile> = {};
  const a = body.answers ?? {};
  if (typeof a.displayName === "string")
    answers.displayName = sanitizeAnswer(a.displayName) || undefined;
  if (CATEGORIES.includes(a.seeking as Category))
    answers.seeking = a.seeking as Category;
  if (typeof a.lookingFor === "string")
    answers.lookingFor = sanitizeAnswer(a.lookingFor) || undefined;
  if (Array.isArray(a.interests)) {
    const cleaned = a.interests
      .filter((i): i is string => typeof i === "string")
      .map(sanitizeAnswer)
      .filter(Boolean)
      .slice(0, 3);
    if (cleaned.length > 0) answers.interests = cleaned;
  }
  if (typeof a.funFact === "string")
    answers.funFact = sanitizeAnswer(a.funFact) || undefined;

  // Apply the new message to the field it answers.
  if (body.field && typeof body.message === "string") {
    const msg = sanitizeAnswer(body.message);
    if (msg) {
      switch (body.field) {
        case "displayName":
          answers.displayName = msg.slice(0, 40);
          break;
        case "seeking": {
          const m = msg.toLowerCase();
          const cat = CATEGORIES.find((c) => m.includes(c.slice(0, 5)));
          if (cat) answers.seeking = cat;
          break;
        }
        case "lookingFor":
          answers.lookingFor = msg;
          break;
        case "interests":
          answers.interests = msg
            .split(/[,;]| and /i)
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 3);
          break;
        case "funFact":
          answers.funFact = msg;
          break;
      }
    }
  }

  const nextField = nextMissing(answers);
  if (nextField === null) {
    const profile = answers as OnboardingProfile;
    const res: OnboardResponse = {
      reply: `Perfect, ${profile.displayName} — I've got what I need. I'll brief the contestants with a summary (never your exact words). Ready to open the bracket?`,
      nextField: null,
      done: true,
      answers,
      profile,
    };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  }

  // Re-ask when the message didn't parse (e.g. category not recognized).
  const q = questionFor(nextField, answers);
  const retry =
    body.field === nextField
      ? nextField === "seeking"
        ? {
            reply:
              "I can work with people, products, or places — which one is it today?",
            suggestions: ["People", "Products", "Places"],
          }
        : q
      : q;

  const res: OnboardResponse = {
    ...retry,
    nextField,
    done: false,
    answers,
  };
  return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
}
