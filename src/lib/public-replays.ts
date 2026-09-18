import { stripSpeechControlTokens } from "../../server/src/onboarding/profile";
import type { MatchRecord, PersonaLite, TournamentSummary } from "./matches";
import type { Avatar } from "./types";

export type PublicShow = Omit<TournamentSummary, "matches" | "phase"> & {
  phase: "FINAL";
  isPublic: true;
  summaryTitle: string;
};
export type PublicReplay = PublicShow & { matches: MatchRecord[] };

export function publicText(value: string, fallback: string, limit = 160): string {
  return stripSpeechControlTokens(value.slice(0, 4096)).slice(0, limit) || fallback;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid public tournament response");
  }
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) throw new Error("Invalid public text");
  return value;
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("Invalid match index");
  return value as number;
}
function date(value: unknown): string {
  const text = string(value);
  if (!Number.isFinite(Date.parse(text))) throw new Error("Invalid tournament date");
  return text;
}
export function validTournamentId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
}
function id(value: unknown): string {
  const text = string(value);
  if (!validTournamentId(text)) throw new Error("Invalid public identifier");
  return text;
}

function avatar(value: unknown, allowedHosts: string[]): Avatar {
  const input = record(value);
  const source = string(input.value);
  if (input.kind === "emoji") return { kind: "emoji", value: publicText(source, "◇", 32) };
  if (input.kind === "stream") return { kind: "stream", value: "" };
  if (input.kind === "image") {
    // Untrusted image URLs otherwise disclose a public viewer's IP to any host.
    // Relative paths must be local assets, not protocol-relative or backslash URLs.
    if (/^\/(?!\/)[a-zA-Z0-9/_\-.]+$/.test(source)) return { kind: "image", value: source };
    try {
      const url = new URL(source);
      if (url.protocol === "https:" && !url.username && !url.password && allowedHosts.includes(url.host)) {
        return { kind: "image", value: url.href };
      }
    } catch { /* Use a neutral glyph for untrusted sources. */ }
  }
  return { kind: "emoji", value: "◇" };
}
function persona(value: unknown, allowedHosts: string[]): PersonaLite {
  const input = record(value);
  return { id: id(input.id), name: publicText(string(input.name), "Contestant", 120), avatar: avatar(input.avatar, allowedHosts) };
}

/** Projection used immediately before public rendering, including metadata.
 * Authorization remains the API's responsibility; this also fails closed if
 * private or nonfinal data is accidentally returned by that API.
 */
export function parsePublicShow(value: unknown, allowedHosts: string[] = []): PublicShow | null {
  const input = record(value);
  if (input.isPublic !== true || input.phase !== "FINAL" || !input.finishedAt) return null;
  if (!["people", "products", "places"].includes(string(input.category))) throw new Error("Invalid category");
  const bracketSize = integer(input.bracketSize);
  if (bracketSize < 2 || bracketSize > 64 || !Number.isInteger(Math.log2(bracketSize))) throw new Error("Invalid bracket size");
  return {
    id: id(input.id), category: input.category as PublicShow["category"], bracketSize,
    phase: "FINAL", isPublic: true,
    summaryTitle: publicText(input.summaryTitle == null ? "" : string(input.summaryTitle), "A match worth watching"),
    winner: input.winner == null ? null : persona(input.winner, allowedHosts),
    createdAt: date(input.createdAt), finishedAt: date(input.finishedAt),
  };
}

export function parsePublicReplay(value: unknown, allowedHosts: string[] = []): PublicReplay | null {
  const show = parsePublicShow(value, allowedHosts);
  if (!show) return null;
  const input = record(value);
  if (!Array.isArray(input.matches) || input.matches.length > 63) throw new Error("Invalid matches");
  const matches = input.matches.map((value): MatchRecord => {
    const m = record(value);
    const entrantA = persona(m.entrantA, allowedHosts), entrantB = persona(m.entrantB, allowedHosts);
    const winnerId = m.winnerId === null ? null : id(m.winnerId);
    if (winnerId !== null && winnerId !== entrantA.id && winnerId !== entrantB.id) throw new Error("Invalid match winner");
    const round = integer(m.round), matchIndex = integer(m.matchIndex);
    if (round >= Math.log2(show.bracketSize) || matchIndex >= show.bracketSize / 2 ** (round + 1)) throw new Error("Invalid bracket position");
    return { id: id(m.id), round, matchIndex, entrantA, entrantB, winnerId, decidedAt: m.decidedAt === null ? null : date(m.decidedAt) };
  }).sort((a, b) => a.round - b.round || a.matchIndex - b.matchIndex);
  if (new Set(matches.map(m => `${m.round}:${m.matchIndex}`)).size !== matches.length) throw new Error("Duplicate bracket position");
  return { ...show, matches };
}

export function showDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
