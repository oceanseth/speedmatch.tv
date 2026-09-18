import "server-only";
import { cache } from "react";
import { parsePublicReplay, parsePublicShow, validTournamentId, type PublicShow } from "./public-replays";

export const PUBLIC_SITE_URL = "https://www.speedmatch.tv";
const allowedAvatarHosts = (process.env.PUBLIC_AVATAR_HOSTS ?? "").split(",").map(host => host.trim()).filter(Boolean);

async function publicRequest(path: string): Promise<unknown | null> {
  // Fixed operator-controlled origin: never trust an inbound Host/X-Forwarded-Host.
  // The API lives in the same service by default; no account cookies are forwarded.
  const origin = process.env.TOURNAMENT_API_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
  const response = await fetch(new URL(path, origin), {
    // Loopback has no CDN in front of it: revalidate here is what actually
    // cuts DB hits for page renders. Bounded like the route headers so a
    // visibility withdrawal propagates within ~30s.
    next: { revalidate: 30 }, redirect: "error", signal: AbortSignal.timeout(5000),
    headers: { Accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Public tournaments are unavailable");
  return response.json();
}

export const getPublicReplay = cache(async (tournamentId: string) => {
  if (!validTournamentId(tournamentId)) return null;
  const body = await publicRequest(`/api/tournaments/${encodeURIComponent(tournamentId)}/matches`);
  if (body === null) return null;
  const tournament = (body as { tournament?: unknown }).tournament;
  const replay = parsePublicReplay(tournament, allowedAvatarHosts);
  if (replay && replay.id !== tournamentId) throw new Error("Public tournament ID mismatch");
  return replay;
});

export async function getRecentShows(): Promise<PublicShow[]> {
  const body = await publicRequest("/api/tournaments/public");
  if (!body || !Array.isArray((body as { tournaments?: unknown }).tournaments)) throw new Error("Public shows are unavailable");
  return ((body as { tournaments: unknown[] }).tournaments)
    .map(value => parsePublicShow(value, allowedAvatarHosts))
    .filter((value): value is PublicShow => value !== null)
    .sort((a, b) => Date.parse(b.finishedAt!) - Date.parse(a.finishedAt!))
    .slice(0, 6);
}
