import { NextResponse } from "next/server";
import { TransitionError } from "@speedmatch/server/tournament";
import {
  loadTournament,
  applyEvent,
  seedFromCatalog,
  VersionConflict,
} from "../../../../../lib/tournamentStore";
import { query } from "../../../../../lib/db";

export const dynamic = "force-dynamic";

const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

/**
 * Owner starts the show. Requires a completed onboarding profile (the
 * interview happens on /session/new before the stage): LOBBY →
 * START_ONBOARD → ONBOARD_COMPLETE → SEEDED from the persona catalog →
 * PITCH_A with the first leg's 15s clock running. From here the events
 * poll drives every timer transition; only decisions need the owner again.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const { getAppUser } = await import("../../../../../lib/identity");
  const user = await getAppUser(_req.headers).catch(() => null);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let row = await loadTournament(id).catch(() => null);
  if (!row || row.userId !== user.id) return notFound();
  if (row.state.phase !== "LOBBY") {
    return NextResponse.json(
      { error: "already_started", phase: row.state.phase },
      { status: 409 },
    );
  }
  // New tournaments carry the reviewed per-session snapshot bound at
  // creation (migration 008); the show runs from that, not from whatever
  // the account defaults say by the time Start is pressed. Tournaments
  // created before the snapshot existed keep the old account-level gate.
  if (row.matchContext === null) {
    const hasProfile = await query(
      `SELECT 1 FROM onboarding_profiles WHERE user_id = $1`,
      [user.id],
    );
    if (hasProfile.length === 0) {
      return NextResponse.json({ error: "no_profile" }, { status: 409 });
    }
  }

  try {
    const now = Date.now();
    row = await applyEvent(row, { type: "START_ONBOARD" }, now);
    row = await applyEvent(row, { type: "ONBOARD_COMPLETE" }, now);
    row = await seedFromCatalog(row, now);
    return NextResponse.json(
      { state: row.state, version: row.version, serverNow: now },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof VersionConflict) {
      return NextResponse.json({ error: "conflict_retry" }, { status: 409 });
    }
    if (err instanceof TransitionError) {
      return NextResponse.json({ error: err.code }, { status: 409 });
    }
    console.error("[tournaments/start]", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
