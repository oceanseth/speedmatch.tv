import { NextResponse } from "next/server";
import { TransitionError } from "@speedmatch/server/tournament";
import {
  loadTournament,
  catchUpTimers,
  applyEvent,
  VersionConflict,
} from "../../../../../lib/tournamentStore";

export const dynamic = "force-dynamic";

const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

/**
 * Owner picks A or B. Ownership AND phase AND the version CAS are all
 * re-checked here (Opus checklist): spectators and non-owners get the
 * opaque 404, a decision after the deadline lapses honestly fails, and a
 * concurrent transition beats the click cleanly.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const { getAppUser } = await import("../../../../../lib/identity");
  const user = await getAppUser(req.headers).catch(() => null);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let winner: "A" | "B" | null = null;
  try {
    const body: unknown = await req.json();
    const w = (body as { winner?: unknown })?.winner;
    if (w === "A" || w === "B") winner = w;
  } catch {
    // handled below
  }
  if (!winner) return NextResponse.json({ error: "bad_winner" }, { status: 400 });

  let row = await loadTournament(id).catch(() => null);
  if (!row || row.userId !== user.id) return notFound();

  const now = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      row = await catchUpTimers(row, now);
      row = await applyEvent(row, { type: "USER_DECISION", winner }, now);
      return NextResponse.json(
        { state: row.state, version: row.version, serverNow: now },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (err) {
      if (err instanceof VersionConflict && attempt === 0) {
        const fresh = await loadTournament(id).catch(() => null);
        if (!fresh) return notFound();
        row = fresh;
        continue;
      }
      if (err instanceof TransitionError) {
        return NextResponse.json(
          { error: err.code, phase: row.state.phase },
          { status: err.code === "BAD_DECISION" ? 400 : 409 },
        );
      }
      console.error("[tournaments/decision]", err);
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
  }
  return NextResponse.json({ error: "conflict_retry" }, { status: 409 });
}
