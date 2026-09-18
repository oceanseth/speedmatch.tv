import { NextResponse } from "next/server";
import { createTournament } from "@speedmatch/server/tournament";
import { getAppUser } from "../../../lib/identity";
import { query } from "../../../lib/db";
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
  try {
    const body: unknown = await req.json();
    const c = (body as { category?: unknown })?.category;
    if (typeof c === "string") category = c;
    isPublic = (body as { isPublic?: unknown })?.isPublic === true;
  } catch {
    // fall through to the category check
  }
  if (!CATEGORIES.has(category)) {
    return NextResponse.json({ error: "bad_category" }, { status: 400 });
  }

  const state = createTournament();
  const rows = await query<{ id: string; version: number }>(
    `INSERT INTO tournaments (user_id, category, bracket_size, state, is_public)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING id, version`,
    [user.id, category, state.bracketSize, JSON.stringify(state), isPublic],
  );
  return NextResponse.json(
    { id: rows[0].id, version: rows[0].version, state },
    { status: 201 },
  );
}

export type TournamentCategory = Category;
