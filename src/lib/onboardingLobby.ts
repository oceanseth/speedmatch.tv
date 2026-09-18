import type { Category } from "./types";

export type LobbyResult =
  | { status: "ready"; href: string }
  | { status: "signin" }
  | { status: "failed" };

export const TOURNAMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Called only by the explicit public-lobby CTA. Ownership stays server-side. */
export async function enterPublicLobby(category: Category): Promise<LobbyResult> {
  try {
    const response = await fetch("/api/tournaments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, isPublic: true }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401) return { status: "signin" };
    if (response.status !== 201 && response.status !== 409) return { status: "failed" };
    const data = await response.json();
    if (typeof data.id !== "string" || !TOURNAMENT_ID.test(data.id)) return { status: "failed" };
    const target = ["people", "products", "places"].includes(data.category) ? data.category : category;
    return { status: "ready", href: `/stage/${target}?tournament=${encodeURIComponent(data.id)}` };
  } catch {
    return { status: "failed" };
  }
}
