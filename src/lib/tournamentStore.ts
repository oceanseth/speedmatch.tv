import {
  advance,
  type TournamentEvent,
  type TournamentState,
} from "@speedmatch/server/tournament";
import { query, withTransaction } from "./db";
import type { Category } from "./types";

/**
 * Poll-driven orchestrator core. There is no background worker: every read
 * of a tournament first applies any TIMER_EXPIRED transitions whose
 * deadlines have passed (server clock authoritative), so a show advances
 * whenever anyone is watching — which is the only time advancing matters.
 * All state changes go through the machine + a version CAS; concurrent
 * writers lose cleanly and refetch. session_events seq is allocated
 * MAX(seq)+1 inside the same transaction (the PK serializes appends);
 * tournaments.version moves ONLY on state changes.
 */

export interface TournamentRow {
  id: string;
  userId: string;
  category: Category;
  state: TournamentState;
  version: number;
  isPublic: boolean;
  /** Server-owned reviewed snapshot (migration 008). Private: never include
   * it in event/state payloads; null on tournaments created before it. */
  matchContext: unknown;
}

interface DbRow {
  id: string;
  user_id: string;
  category: Category;
  state: TournamentState;
  version: number;
  is_public: boolean;
  match_context: unknown;
}

const toRow = (r: DbRow): TournamentRow => ({
  id: r.id,
  userId: r.user_id,
  category: r.category,
  state: r.state,
  version: r.version,
  isPublic: r.is_public,
  matchContext: r.match_context ?? null,
});

export async function loadTournament(id: string): Promise<TournamentRow | null> {
  const rows = await query<DbRow>(
    `SELECT id, user_id, category, state, version, is_public, match_context
     FROM tournaments WHERE id = $1`,
    [id],
  );
  return rows.length > 0 ? toRow(rows[0]) : null;
}

export class VersionConflict extends Error {
  constructor() {
    super("tournament version moved underneath this event");
    this.name = "VersionConflict";
  }
}

/**
 * Apply one machine event with optimistic concurrency. Throws
 * TransitionError for invalid events (caller maps to 4xx) and
 * VersionConflict when the CAS loses (caller refetches and retries or
 * gives up). On FINAL/ABANDONED the denormalized artifacts the replay
 * pages read (matches rows, winner_id, finished_at, summary_title) are
 * written in the same transaction.
 */
export async function applyEvent(
  row: TournamentRow,
  event: TournamentEvent,
  now: number,
): Promise<TournamentRow> {
  const next = advance(row.state, event, now); // TransitionError propagates
  return withTransaction(async (client) => {
    // UPDATE takes the row lock; every seq allocation in this transaction
    // is therefore serialized with appendEvent's FOR UPDATE path.
    const updated = await client.query(
      `UPDATE tournaments SET state = $1::jsonb, version = version + 1
       WHERE id = $2 AND version = $3
       RETURNING version`,
      [JSON.stringify(next), row.id, row.version],
    );
    if (updated.rowCount === 0) throw new VersionConflict();
    const version: number = updated.rows[0].version;

    await client.query(
      `INSERT INTO session_events (tournament_id, seq, type, payload)
       SELECT $1, COALESCE(MAX(seq), 0) + 1, $2, $3::jsonb
       FROM session_events WHERE tournament_id = $1`,
      [
        row.id,
        `STATE_${event.type}`,
        JSON.stringify({ phase: next.phase, current: next.current }),
      ],
    );

    if (event.type === "SEEDED") {
      for (let i = 0; i < next.entrants.length; i++) {
        await client.query(
          `INSERT INTO tournament_entrants (tournament_id, persona_id, seed)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [row.id, next.entrants[i], i],
        );
      }
    }

    if (next.phase === "FINAL" || next.phase === "ABANDONED") {
      for (const round of next.rounds) {
        for (const m of round) {
          if (!m.entrantA || !m.entrantB) continue;
          await client.query(
            `INSERT INTO matches (tournament_id, round, match_index, entrant_a, entrant_b, winner, decided_at)
             VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6::uuid IS NULL THEN NULL ELSE now() END)
             ON CONFLICT (tournament_id, round, match_index)
               DO UPDATE SET winner = EXCLUDED.winner, decided_at = EXCLUDED.decided_at`,
            [row.id, m.round, m.index, m.entrantA, m.entrantB, m.winner],
          );
        }
      }
      if (next.phase === "FINAL" && next.winner) {
        const winnerName = await client.query(
          `SELECT name FROM personas WHERE id = $1`,
          [next.winner],
        );
        const title = winnerName.rows[0]
          ? `${winnerName.rows[0].name} takes the ${row.category} bracket`
          : null;
        await client.query(
          `UPDATE tournaments SET winner_id = $1, finished_at = now(), summary_title = COALESCE(summary_title, $2)
           WHERE id = $3`,
          [next.winner, title, row.id],
        );
      }
      if (next.phase === "ABANDONED") {
        await client.query(
          `UPDATE tournaments SET finished_at = now() WHERE id = $1`,
          [row.id],
        );
      }
    }

    return { ...row, state: next, version };
  });
}

/**
 * Advance every lapsed timer (a poll after a long gap may cascade through
 * several phases). Refetches on CAS conflict — another poller advancing
 * concurrently is success, not failure.
 */
export async function catchUpTimers(
  row: TournamentRow,
  now: number,
): Promise<TournamentRow> {
  let current = row;
  for (let guard = 0; guard < 12; guard++) {
    const { state } = current;
    if (state.deadlineAt == null || now < state.deadlineAt) return current;
    try {
      current = await applyEvent(current, { type: "TIMER_EXPIRED" }, now);
    } catch (err) {
      if (err instanceof VersionConflict) {
        const fresh = await loadTournament(current.id);
        if (!fresh) return current;
        current = fresh;
        continue;
      }
      throw err;
    }
  }
  return current;
}

/** SEED from the persona catalog: bracketSize random personas in category. */
export async function seedFromCatalog(
  row: TournamentRow,
  now: number,
): Promise<TournamentRow> {
  const n = row.state.bracketSize;
  const picks = await query<{ id: string }>(
    `SELECT id FROM personas WHERE category = $1 ORDER BY random() LIMIT $2`,
    [row.category, n],
  );
  if (picks.length < n) {
    throw new Error(`persona catalog has ${picks.length}/${n} for ${row.category}`);
  }
  return applyEvent(row, { type: "SEEDED", entrants: picks.map((p) => p.id) }, now);
}

export interface SessionEventRow {
  seq: number;
  type: string;
  payload: unknown;
  created_at: string;
}

export async function eventsSince(
  id: string,
  since: number,
): Promise<SessionEventRow[]> {
  return query<SessionEventRow>(
    `SELECT seq, type, payload, created_at FROM session_events
     WHERE tournament_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT 200`,
    [id, since],
  );
}

/**
 * Append a non-state event (chat, audit); never touches version. Takes the
 * tournaments row lock FIRST so it serializes with applyEvent's
 * transaction: without it, two MAX+1 computations interleave, the loser's
 * 23505 fires inside applyEvent's txn, and a user's decision is rolled
 * back because a spectator typed at the same instant (Opus #27 finding 3).
 */
export async function appendEvent(
  id: string,
  type: string,
  payload: unknown,
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(`SELECT 1 FROM tournaments WHERE id = $1 FOR UPDATE`, [id]);
    await client.query(
      `INSERT INTO session_events (tournament_id, seq, type, payload)
       SELECT $1, COALESCE(MAX(seq), 0) + 1, $2, $3::jsonb
       FROM session_events WHERE tournament_id = $1`,
      [id, type, JSON.stringify(payload)],
    );
  });
}
