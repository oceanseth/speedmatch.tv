import { NextResponse } from "next/server";
import { getPublicTournament } from "../../../../../lib/publicTournaments";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Unknown, private, unfinished, and malformed ids all get this exact
// response — no existence oracle.
const notFound = () =>
  NextResponse.json({ error: "not_found" }, { status: 404 });

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return notFound();
  try {
    const tournament = await getPublicTournament(id);
    if (!tournament) return notFound();
    return NextResponse.json(
      { tournament },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
