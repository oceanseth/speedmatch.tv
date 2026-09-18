import { NextResponse } from "next/server";
import { listPublicTournaments } from "../../../../lib/publicTournaments";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tournaments = await listPublicTournaments();
    return NextResponse.json(
      { tournaments },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    // No DB detail to the client; it may describe our server env.
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
