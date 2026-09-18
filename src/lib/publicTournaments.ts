import { query } from "./db";
import type { MatchRecord, PersonaLite, TournamentSummary } from "./matches";
import type { Category } from "./types";

// Contract agreed in-channel 2026-09-18: list entries are TournamentSummary
// minus `matches` plus `isPublic: true` / `summaryTitle`; the detail endpoint
// includes matches. Both expose ONLY `is_public AND phase = 'FINAL'` rows —
// visibility is enforced in the SQL, and unknown/private/unfinished ids are
// indistinguishable 404s at the route layer.
export type PublicTournamentEntry = Omit<TournamentSummary, "matches"> & {
  isPublic: true;
  summaryTitle: string | null;
};

export type PublicTournament = PublicTournamentEntry & {
  matches: MatchRecord[];
};

const CATEGORY_EMOJI: Record<Category, string> = {
  people: "🧑",
  products: "📦",
  places: "📍",
};

export function personaLite(
  id: string,
  name: string,
  imageUrl: string | null,
  category: Category,
): PersonaLite {
  return {
    id,
    name,
    avatar: imageUrl
      ? { kind: "image", value: imageUrl }
      : { kind: "emoji", value: CATEGORY_EMOJI[category] },
  };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

interface TournamentRow {
  id: string;
  category: Category;
  bracketSize: number;
  createdAt: Date;
  finishedAt: Date | null;
  summaryTitle: string | null;
  winnerId: string | null;
  winnerName: string | null;
  winnerImage: string | null;
}

const TOURNAMENT_SELECT = `
  SELECT t.id, t.category, t.bracket_size AS "bracketSize",
         t.created_at AS "createdAt", t.finished_at AS "finishedAt",
         t.summary_title AS "summaryTitle",
         w.id AS "winnerId", w.name AS "winnerName", w.image_url AS "winnerImage"
  FROM tournaments t
  LEFT JOIN personas w ON w.id = t.winner_id
  WHERE t.is_public AND t.phase = 'FINAL'`;

function toEntry(row: TournamentRow): PublicTournamentEntry {
  return {
    id: row.id,
    category: row.category,
    bracketSize: row.bracketSize,
    phase: "FINAL",
    winner:
      row.winnerId && row.winnerName
        ? personaLite(row.winnerId, row.winnerName, row.winnerImage, row.category)
        : null,
    createdAt: row.createdAt.toISOString(),
    finishedAt: iso(row.finishedAt),
    summaryTitle: row.summaryTitle,
    isPublic: true,
  };
}

export async function listPublicTournaments(): Promise<PublicTournamentEntry[]> {
  const rows = await query<TournamentRow>(
    `${TOURNAMENT_SELECT}
     ORDER BY t.finished_at DESC NULLS LAST
     LIMIT 12`,
  );
  return rows.map(toEntry);
}

interface MatchRow {
  id: string;
  round: number;
  matchIndex: number;
  winnerId: string | null;
  decidedAt: Date | null;
  aId: string | null;
  aName: string | null;
  aImage: string | null;
  bId: string | null;
  bName: string | null;
  bImage: string | null;
}

export async function getPublicTournament(
  id: string,
): Promise<PublicTournament | null> {
  const rows = await query<TournamentRow>(`${TOURNAMENT_SELECT} AND t.id = $1`, [id]);
  if (rows.length === 0) return null;
  const entry = toEntry(rows[0]);

  const matchRows = await query<MatchRow>(
    `SELECT m.id, m.round, m.match_index AS "matchIndex", m.winner AS "winnerId",
            m.decided_at AS "decidedAt",
            a.id AS "aId", a.name AS "aName", a.image_url AS "aImage",
            b.id AS "bId", b.name AS "bName", b.image_url AS "bImage"
     FROM matches m
     LEFT JOIN personas a ON a.id = m.entrant_a
     LEFT JOIN personas b ON b.id = m.entrant_b
     WHERE m.tournament_id = $1
     ORDER BY m.round ASC, m.match_index ASC`,
    [id],
  );

  const matches: MatchRecord[] = [];
  for (const m of matchRows) {
    // A FINAL tournament's matches always carry both entrants; a row that
    // doesn't (partial write, future bye semantics) is dropped rather than
    // invented — the UI contract requires PersonaLite on both sides.
    if (!m.aId || !m.aName || !m.bId || !m.bName) continue;
    matches.push({
      id: m.id,
      round: m.round,
      matchIndex: m.matchIndex,
      entrantA: personaLite(m.aId, m.aName, m.aImage, entry.category),
      entrantB: personaLite(m.bId, m.bName, m.bImage, entry.category),
      winnerId: m.winnerId,
      decidedAt: iso(m.decidedAt),
    });
  }
  return { ...entry, matches };
}
