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

// Dynamic import on purpose: onboardingStore carries the "server-only"
// poison import (via identity/auth), which Next aliases but the node test
// runner cannot resolve. Deferring the load keeps this route module
// importable by the scripted-flow tests; under Next the handlers behave
// identically.
const store = () => import("../../../lib/onboardingStore");

/**
 * Returning users skip the interview: the saved profile for the signed-in
 * account, or null for anonymous / first-timers.
 */
export async function GET(req: Request) {
  try {
    const { loadProfile } = await store();
    const profile = await loadProfile(req.headers);
    return NextResponse.json(
      { profile },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

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

// Every legit body is a handful of short answers; anything bigger is abuse.
// Sanitization is regex work, so the cap must run before any parsing/
// sanitizing — this endpoint is unauthenticated, and once it fronts Higgs
// Realtime it becomes a spend endpoint that also needs the broker's
// rate limiter in front of it.
const MAX_BODY_BYTES = 8_192;
const MAX_INTERESTS = 3;

/**
 * Read the body without ever buffering more than maxBytes: reject on the
 * Content-Length header when present, and count decoded bytes (not UTF-16
 * code units) as chunks arrive, cancelling the stream the moment the cap
 * is crossed — a chunked body with an absent or lying header still can't
 * make us hold more than one chunk past the limit. Returns null when the
 * cap is exceeded.
 */
async function readBodyCapped(
  req: Request,
  maxBytes: number,
): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  // Manual concat keeps this runtime-portable (Buffer would pin us to Node).
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// The host literally asks "a person, a product, or a place?" — match the
// natural answers, not just the plural table names.
const CATEGORY_SYNONYMS: Record<Category, string[]> = {
  people: ["people", "person", "human", "someone", "somebody", "date"],
  products: ["products", "product", "gadget", "thing", "item", "something to buy"],
  places: ["places", "place", "destination", "city", "location", "somewhere", "trip", "travel"],
};

function parseCategory(msg: string): Category | undefined {
  const m = msg.toLowerCase();
  return CATEGORIES.find((c) => CATEGORY_SYNONYMS[c].some((s) => m.includes(s)));
}

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

// Conversation-control utterances are feedback to the host, never answers
// (David's regression profile: "Let me speak. You should wait until I
// answer" was stored as his fun fact).
const CONTROL_RE =
  /\b(let me (speak|talk|finish|answer)|wait until i answer|you should wait|hold on|hang on|one (sec|second|moment)|stop( talking| it)?|can you hear me|shut up|be quiet|slow down|start over)\b/i;

/**
 * A control phrase is an UTTERANCE, not a substring: "somewhere I can stop
 * and think" is a real answer, not a request to stop (Opus #26 finding 3).
 * Strategy: strip every control-phrase match and conversational filler; if
 * almost nothing remains, the message was control through and through —
 * which also catches David's stuttered "Let me speak. You, you, you
 * should, you should wait until I answer."
 */
function isControlUtterance(msg: string): boolean {
  // Structural discriminator (Opus): a control phrase is the whole
  // utterance; an answer opens with a declarative frame. "I want to slow
  // down" is a goal, not a command — never classify framed speech as
  // control regardless of what follows.
  if (/^\s*(i\s+want|i\s+need|i'?m\s+looking\s+for|somewhere|a\s+|an\s+|the\s+)/i.test(msg)) {
    return false;
  }
  if (!CONTROL_RE.test(msg)) return false;
  const residue = msg
    .replace(new RegExp(CONTROL_RE.source, "gi"), " ")
    .replace(/\b(you|i|me|we|it|should|would|please|now|then|just|really|can|could|will|wait|until|answer|ok|okay|so|and|uh|um)\b/gi, " ")
    .replace(/[^A-Za-z]/g, "");
  return residue.length <= 6;
}

// Contentless answers that identify nothing to pitch against ("The best.").
const VAGUE_RE =
  /^(the\s+|a\s+|an\s+)?(best|good|great|nice|cool|fine|anything|whatever|something|idk|i don'?t know)(\s+one)?[.!\s]*$/i;

// A voice fragment applied twice must not fill two different fields.
function isDuplicateAnswer(
  msg: string,
  answers: Partial<OnboardingProfile>,
): boolean {
  const norm = (v: string) => v.toLowerCase().replace(/[.!?\s]+$/g, "").trim();
  const values = [
    answers.displayName,
    answers.lookingFor,
    answers.funFact,
    ...(answers.interests ?? []),
  ].filter((v): v is string => Boolean(v));
  return values.some((v) => norm(v) === norm(msg));
}

function nextMissing(answers: Partial<OnboardingProfile>): OnboardField | null {
  for (const f of ORDER) {
    if (answers[f] === undefined) return f;
  }
  return null;
}

// "I'm looking for..." must not become a display name.
const NAME_STOPWORDS = new Set([
  "looking", "searching", "trying", "hoping", "wanting", "going", "gonna",
  "here", "just", "not", "really", "interested", "sorry", "good", "fine",
  // Articles/prepositions: "I'm a designer", "I'm from Seattle" are
  // self-descriptions, not names (Opus #26 finding 2).
  "a", "an", "the", "from", "with", "in", "at", "on",
]);

const NAME_RE =
  /(?:i'?m|i am|my name is|call me|this is)\s+([A-Za-z][\w'-]*(?:\s+[A-Za-z][\w'-]*)?)/i;

/** "I'm David and I want…" → "David"; undefined when no safe capture. */
function extractName(msg: string): string | undefined {
  const raw = msg.match(NAME_RE)?.[1]?.trim();
  if (!raw) return undefined;
  // The optional second word is for "Maya Chen", not "David and…".
  const candidate = raw.replace(/\s+(and|but|so|here|from|by)$/i, "");
  if (NAME_STOPWORDS.has(candidate.split(/\s+/)[0].toLowerCase())) return undefined;
  return candidate;
}

/**
 * Fill OTHER missing fields from the same utterance (David's pacing report:
 * one field per answer makes "I'm David, I want a hiking buddy" take five
 * questions). Conservative by design: only fills blanks, never overwrites,
 * skips the field the message was aimed at, and interests/funFact stay
 * directed-only (list-shape guessing produces garbage). Returns the fields
 * it captured so the host can acknowledge them.
 */
function extractExtras(
  msg: string,
  answers: Partial<OnboardingProfile>,
  directedField: OnboardField | null,
): OnboardField[] {
  const captured: OnboardField[] = [];
  if (answers.displayName === undefined && directedField !== "displayName") {
    const candidate = extractName(msg);
    if (candidate) {
      answers.displayName = candidate.slice(0, 40);
      captured.push("displayName");
    }
  }
  if (answers.seeking === undefined && directedField !== "seeking") {
    const cat = parseCategory(msg);
    if (cat) {
      answers.seeking = cat;
      captured.push("seeking");
    }
  }
  if (answers.lookingFor === undefined && directedField !== "lookingFor") {
    const m = msg.match(
      /(?:looking for|want to find|searching for|hoping to find|i want|i need)\s+(.{8,})/i,
    );
    const goal = m?.[1]?.trim();
    // "I want a person" answering the CATEGORY question is a category, not
    // a goal — a bare category term must not poison lookingFor (Opus #26
    // finding 1: fired for "a person"/"a product" but not "a place").
    const bareCategory =
      /^(a\s+|an\s+|the\s+)?(person|people|product|products|place|places|someone|somebody|something)[.!\s]*$/i;
    if (goal && !bareCategory.test(goal)) {
      answers.lookingFor = goal;
      captured.push("lookingFor");
    }
  }
  return captured;
}

export async function POST(req: Request) {
  let body: OnboardRequest;
  try {
    const raw = await readBodyCapped(req, MAX_BODY_BYTES);
    if (raw === null)
      return NextResponse.json({ error: "payload too large" }, { status: 413 });
    body = JSON.parse(raw) as OnboardRequest;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  // Re-sanitize everything the client sent; the client's copy is a
  // convenience, never a trusted value.
  const answers: Partial<OnboardingProfile> = {};
  const a = body.answers ?? {};
  if (typeof a.displayName === "string")
    answers.displayName = sanitizeAnswer(a.displayName).slice(0, 40) || undefined;
  if (CATEGORIES.includes(a.seeking as Category))
    answers.seeking = a.seeking as Category;
  if (typeof a.lookingFor === "string")
    answers.lookingFor = sanitizeAnswer(a.lookingFor) || undefined;
  if (Array.isArray(a.interests)) {
    // Bound the array before any sanitizing runs — a huge array here is
    // one regex pass per element on an unauthenticated endpoint.
    if (a.interests.length > MAX_INTERESTS)
      return NextResponse.json({ error: "bad request" }, { status: 400 });
    const cleaned = a.interests
      .filter((i): i is string => typeof i === "string")
      .map((i) => sanitizeAnswer(i))
      .filter(Boolean);
    if (cleaned.length > 0) answers.interests = cleaned;
  }
  if (typeof a.funFact === "string")
    answers.funFact = sanitizeAnswer(a.funFact) || undefined;

  // Deflections: control phrases, duplicates, and contentless answers get a
  // re-ask instead of polluting the profile.
  let deflect: string | null = null;
  if (body.field && typeof body.message === "string") {
    const msg = sanitizeAnswer(body.message);
    if (msg) {
      if (isControlUtterance(msg)) {
        deflect = "Sorry — go ahead, I'm listening. ";
      } else if (isDuplicateAnswer(msg, answers)) {
        deflect = "I've already got that one down. ";
      } else if (
        (body.field === "lookingFor" || body.field === "funFact") &&
        VAGUE_RE.test(msg)
      ) {
        deflect =
          body.field === "lookingFor"
            ? '"The best" gives the contestants nothing to pitch against — best HOW? One concrete thing it should do for you: '
            : "Give me something real — one specific thing about you: ";
      }
    }
  }

  // Apply the new message to the field it answers.
  if (!deflect && body.field && typeof body.message === "string") {
    const msg = sanitizeAnswer(body.message);
    if (msg) {
      switch (body.field) {
        case "displayName":
          // "I'm David and I want a hiking buddy" must yield "David", not
          // the whole sentence; a plain "David" answer passes through.
          answers.displayName = (extractName(msg) ?? msg).slice(0, 40);
          break;
        case "seeking": {
          const cat = parseCategory(msg);
          if (cat) answers.seeking = cat;
          break;
        }
        case "lookingFor":
          answers.lookingFor = msg;
          break;
        case "interests": {
          const list = msg
            .split(/[,;]| and /i)
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, MAX_INTERESTS);
          // "," sanitizes to "," and splits to nothing — an empty list is
          // not an answer, so leave the field unset and re-ask.
          if (list.length > 0) answers.interests = list;
          break;
        }
        case "funFact":
          answers.funFact = msg;
          break;
      }
    }
  }

  // Opportunistic multi-field capture from the same utterance.
  let extras: OnboardField[] = [];
  if (!deflect && typeof body.message === "string") {
    const msg = sanitizeAnswer(body.message);
    if (msg) extras = extractExtras(msg, answers, body.field ?? null);
  }

  // A signed-in account already told us its name — never ask for it again.
  if (answers.displayName === undefined) {
    try {
      const { getAppUser } = await import("../../../lib/identity");
      const user = await getAppUser(req.headers);
      if (user?.displayName) answers.displayName = user.displayName.slice(0, 40);
    } catch {
      // Anonymous, or auth unavailable (e.g. under the node test runner):
      // the interview simply asks.
    }
  }

  const nextField = nextMissing(answers);
  if (nextField === null) {
    const profile = answers as OnboardingProfile;
    // Signed-in users keep their answers (Seth's live-test finding: the
    // interview evaporated). "anonymous" and "failed" are different truths:
    // the UI says "sign in to keep this" for one and "we couldn't save
    // that, try again" for the other — never blames the signed-in user for
    // a server failure.
    const saved = await store()
      .then(({ saveProfile }) => saveProfile(req.headers, profile))
      .catch((err): "failed" => {
        console.error("[onboard] profile save failed", err);
        return "failed";
      });
    const res: OnboardResponse = {
      reply: `Perfect, ${profile.displayName} — I've got what I need. I'll brief the contestants with a summary (never your exact words). Ready to open the bracket?`,
      nextField: null,
      done: true,
      answers,
      profile,
      saved,
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

  if (deflect && nextField !== null) {
    const q = questionFor(nextField, answers);
    const res: OnboardResponse = {
      // Vague-answer deflects end ": " and ARE the focused re-ask; control
      // and duplicate deflects need the actual question appended.
      reply: deflect + (deflect.endsWith(": ") ? "" : q.reply),
      suggestions: q.suggestions,
      nextField,
      done: false,
      answers,
    };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  }

  // Let the user HEAR that one utterance landed several answers.
  const ack =
    extras.length >= 2
      ? "Got several answers out of that at once — efficient. "
      : extras.length === 1
        ? "I caught an extra answer in there too. "
        : "";
  const res: OnboardResponse = {
    ...retry,
    reply: ack + retry.reply,
    nextField,
    done: false,
    answers,
  };
  return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
}
