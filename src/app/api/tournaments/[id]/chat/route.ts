import { createHmac, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { stripSpeechControlTokens } from "@speedmatch/server/onboarding";
import { RateLimiter, defaultClientKey } from "@speedmatch/server/boson";
import {
  loadTournament,
  appendEvent,
} from "../../../../../lib/tournamentStore";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAT_MAX_CHARS = 280;

// Per-sender-per-round cap, PLUS a per-IP-per-tournament cap: the sender id
// is a self-issued cookie (one GET /api/session rotates it), so the IP
// dimension — the one the client can't choose — is what actually bounds a
// public show's chat (Opus #27 finding 2).
const chatLimiter = new RateLimiter(10);
const chatIpLimiter = new RateLimiter(30);

// The broadcast payload must never carry the raw sender id: for anonymous
// viewers that IS their sm_sid bearer cookie, and /events hands the payload
// to every spectator (Opus #27 finding 1). A per-tournament HMAC gives a
// stable in-show pseudonym instead. Key falls back to a process-random
// value when the env secret is absent (pseudonyms merely reset on restart).
// Dedicated key so rotating the auth secret doesn't reshuffle transcript
// identities (Opus hygiene note); falls back through the auth secret to a
// process-random value (pseudonyms merely reset on restart).
const PSEUDONYM_KEY =
  process.env.PSEUDONYM_KEY ??
  process.env.BETTER_AUTH_SECRET ??
  randomBytes(32).toString("hex");
function pseudonym(tournamentId: string, senderId: string): string {
  return createHmac("sha256", PSEUDONYM_KEY)
    .update(`${tournamentId}:${senderId}`)
    .digest("hex")
    .slice(0, 12);
}

const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

function sessionIdFrom(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const sid = cookie.match(/(?:^|;\s*)sm_sid=([^;]+)/)?.[1];
  return sid && UUID_RE.test(sid) ? sid : null;
}

/**
 * Spectator/stage chat rides session_events as CHAT (never touches
 * tournaments.version). Chat is DATA: sanitized at ingest here and again
 * inside any prompt template that ever reads it; it can never advance
 * state — the crowd is advisory, the server owns the bracket.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return notFound();

  const { getAppUser } = await import("../../../../../lib/identity");
  const user = await getAppUser(req.headers).catch(() => null);
  const senderId = user?.id ?? sessionIdFrom(req);
  if (!senderId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const row = await loadTournament(id).catch(() => null);
  if (!row || (!row.isPublic && row.userId !== (user?.id ?? ""))) return notFound();
  if (row.state.phase === "FINAL" || row.state.phase === "ABANDONED") {
    return NextResponse.json({ error: "show_over" }, { status: 409 });
  }

  let text = "";
  try {
    const body: unknown = await req.json();
    const t = (body as { text?: unknown })?.text;
    if (typeof t === "string") {
      text = stripSpeechControlTokens(t).slice(0, CHAT_MAX_CHARS).trim();
    }
  } catch {
    // empty text handled below
  }
  if (!text) return NextResponse.json({ error: "empty" }, { status: 400 });

  const round = row.state.current?.round ?? -1;
  if (
    !chatLimiter.allow(`${senderId}:${id}:${round}`) ||
    !chatIpLimiter.allow(`${defaultClientKey(req)}:${id}`)
  ) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const displayName = user?.displayName ?? "guest";
  await appendEvent(id, "CHAT", {
    sender: pseudonym(id, senderId),
    displayName,
    text,
    round,
  });
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
