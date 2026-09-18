import { NextResponse } from "next/server";
import { msRemaining } from "@speedmatch/server/tournament";
import { speechLineClamped } from "@speedmatch/server/speech";
import {
  loadTournament,
  catchUpTimers,
  eventsSince,
  type TournamentRow,
} from "../../../../../lib/tournamentStore";
import { personaLite } from "../../../../../lib/publicTournaments";
import { query } from "../../../../../lib/db";
import type { PersonaLite } from "../../../../../lib/matches";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

interface PersonaCard extends PersonaLite {
  tagline: string;
}

async function personaCards(
  row: TournamentRow,
): Promise<Record<string, PersonaCard>> {
  if (row.state.entrants.length === 0) return {};
  const rows = await query<{
    id: string;
    name: string;
    tagline: string;
    image_url: string | null;
  }>(`SELECT id, name, tagline, image_url FROM personas WHERE id = ANY($1)`, [
    row.state.entrants,
  ]);
  const map: Record<string, PersonaCard> = {};
  for (const p of rows) {
    map[p.id] = {
      ...personaLite(p.id, p.name, p.image_url, row.category),
      tagline: p.tagline,
    };
  }
  return map;
}

/**
 * The stage's poll: catches up lapsed timers (this IS the orchestrator's
 * clock), then returns the state snapshot, the entrant cards, the current
 * pitch cue for the host to speak, and incremental events. Access:
 * is_public tournaments are watchable by anyone; private ones only by the
 * owner — same opaque 404 otherwise.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return notFound();
  let row = await loadTournament(id).catch(() => null);
  if (!row) return notFound();
  if (!row.isPublic) {
    const { getAppUser } = await import("../../../../../lib/identity");
    const user = await getAppUser(req.headers).catch(() => null);
    if (!user || user.id !== row.userId) return notFound();
  }

  const now = Date.now();
  try {
    row = await catchUpTimers(row, now);
  } catch (err) {
    console.error("[tournaments/events] catch-up failed", err);
    // Serve the stale snapshot rather than failing the poll.
  }

  const sinceRaw = new URL(req.url).searchParams.get("since");
  const since = Number.isFinite(Number(sinceRaw)) ? Number(sinceRaw) : 0;
  const [events, personas] = await Promise.all([
    eventsSince(id, since),
    personaCards(row),
  ]);

  const { state } = row;
  let pitch: { side: "A" | "B"; personaId: string; line: string } | null = null;
  if ((state.phase === "PITCH_A" || state.phase === "PITCH_B") && state.current) {
    const match = state.rounds[state.current.round][state.current.index];
    const side = state.phase === "PITCH_A" ? "A" : "B";
    const personaId = side === "A" ? match.entrantA : match.entrantB;
    const card = personaId ? personas[personaId] : undefined;
    if (personaId && card) {
      // Host cue: literals are the trusted script; every catalog value is
      // sanitized + clamped on interpolation.
      const line = speechLineClamped`Fifteen seconds on the clock. ${card.name}: ${card.tagline} — make your case!`;
      pitch = { side, personaId, line };
    }
  }

  return NextResponse.json(
    {
      serverNow: now,
      state,
      version: row.version,
      msRemaining: msRemaining(state, now),
      personas,
      pitch,
      events,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
