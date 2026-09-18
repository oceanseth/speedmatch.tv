import { NextResponse } from "next/server";
import { listPublicTournaments } from "../../../../lib/publicTournaments";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tournaments = await listPublicTournaments();
    // Finished tournaments rarely change, but FINAL does not freeze
    // is_public — a user can withdraw visibility. Bounded s-maxage lets the
    // CDN absorb the load while withdrawal still propagates within the TTL.
    return NextResponse.json(
      { tournaments },
      { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" } },
    );
  } catch {
    // No DB detail to the client; it may describe our server env.
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
