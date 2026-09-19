import { NextResponse } from "next/server";
import { createTournament } from "@speedmatch/server/tournament";
import { getAppUser } from "../../../lib/identity";
import { query, withTransaction } from "../../../lib/db";
import { approvedMatchContext } from "../../../lib/matchRequestStore";
import { REQUEST_ID, MAX_PITCH_HISTORY } from "../../../lib/matchRequests";
import type { Category } from "../../../lib/types";

export const dynamic = "force-dynamic";

const CATEGORIES: ReadonlySet<string> = new Set(["people", "products", "places"]);

/**
 * Create a tournament owned by the signed-in account. Requires a Better
 * Auth session — the anonymous sm_sid cookie cannot own tournaments.
 * `isPublic` defaults false (schema's safe default); the stage passes true
 * so spectators can watch. State starts at LOBBY; the orchestrator loop
 * drives every later transition server-side.
 */
export async function POST(req: Request) {
  const user = await getAppUser(req.headers);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let category = "";
  let isPublic = false;
  let requestId: unknown;
  let historyIds: unknown;
  let approved = false;
  try {
    const body: unknown = await req.json();
    const c = (body as { category?: unknown })?.category;
    if (typeof c === "string") category = c;
    isPublic = (body as { isPublic?: unknown })?.isPublic === true;
    const selection = body as { requestId?: unknown; historyIds?: unknown; approveSummary?: unknown };
    requestId = selection?.requestId;
    historyIds = selection?.historyIds ?? [];
    approved = selection?.approveSummary === true;
  } catch {
    // fall through to the category check
  }
  if (!CATEGORIES.has(category)) {
    return NextResponse.json({ error: "bad_category" }, { status: 400 });
  }

  // One live show per account: bounds this unverified-registration write
  // endpoint, and it is the product rule anyway — you finish (or abandon)
  // your tournament before starting the next.
  const live = await query<{ id: string; category: string }>(
    `SELECT id, category FROM tournaments
     WHERE user_id = $1 AND phase NOT IN ('FINAL', 'ABANDONED')
     LIMIT 1`,
    [user.id],
  );
  if (live.length > 0) {
    // The id is the caller's OWN live tournament — returning it lets the
    // lobby button route there instead of dead-ending (no oracle: this
    // branch requires the owner's session).
    return NextResponse.json(
      { error: "live_tournament_exists", id: live[0].id, category: live[0].category },
      { status: 409 },
    );
  }

  if (!approved || typeof requestId !== "string" || !REQUEST_ID.test(requestId) ||
      !Array.isArray(historyIds) || historyIds.length > MAX_PITCH_HISTORY ||
      historyIds.some(id => typeof id !== "string" || !REQUEST_ID.test(id))) {
    return NextResponse.json({ error: "review_required" }, { status: 400 });
  }
  const context = await approvedMatchContext(user.id, requestId, historyIds);
  if (!context || context.current.category !== category) {
    return NextResponse.json({ error: "invalid_request_selection" }, { status: 400 });
  }
  const state = createTournament();
  const created = await withTransaction(async client => {
    // Same account mutex as request saves; concurrent tabs cannot create two
    // active tournaments after both passed the optimistic lookup above.
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [user.id]);
    const active = await client.query(
      "SELECT id, category FROM tournaments WHERE user_id = $1 AND phase NOT IN ('FINAL', 'ABANDONED') LIMIT 1", [user.id],
    );
    if (active.rowCount) return { existing: active.rows[0], row: null };
    const rows = await client.query(
      `INSERT INTO tournaments (user_id, category, bracket_size, state, is_public, match_request_id, match_context)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb) RETURNING id, version`,
      [user.id, category, state.bracketSize, JSON.stringify(state), isPublic, requestId, JSON.stringify(context)],
    );
    return { existing: null, row: rows.rows[0] };
  });
  if (created.existing) return NextResponse.json(
    { error: "live_tournament_exists", id: created.existing.id, category: created.existing.category }, { status: 409 },
  );
  return NextResponse.json(
    { id: created.row.id, version: created.row.version, state },
    { status: 201 },
  );
}

export type TournamentCategory = Category;
