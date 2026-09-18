import { NextResponse } from "next/server";
import { stripSpeechControlTokens } from "@speedmatch/server/onboarding";
import { RateLimiter } from "@speedmatch/server/boson";
import {
  loadTournament,
  appendEvent,
} from "../../../../../lib/tournamentStore";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAT_MAX_CHARS = 280;

// Per-user-per-round cap (Opus checklist). Keyed user:tournament:round;
// per-process like every limiter here.
const chatLimiter = new RateLimiter(10);

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
  if (!chatLimiter.allow(`${senderId}:${id}:${round}`)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const displayName = user?.displayName ?? "guest";
  await appendEvent(id, "CHAT", { senderId, displayName, text, round });
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
