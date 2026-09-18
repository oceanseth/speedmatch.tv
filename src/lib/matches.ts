import type { Avatar, Category } from "./types";

// Mirrors the denormalized `matches` + `tournaments` tables from
// migrations/001_init.sql; the page swaps to a DB query behind auth
// without changing these shapes.
export interface PersonaLite {
  id: string;
  name: string;
  avatar: Avatar;
}

export interface MatchRecord {
  id: string;
  round: number;
  matchIndex: number;
  entrantA: PersonaLite;
  entrantB: PersonaLite;
  winnerId: string | null;
  decidedAt: string | null;
}

export interface TournamentSummary {
  id: string;
  category: Category;
  bracketSize: number;
  phase: "FINAL" | "ABANDONED";
  winner: PersonaLite | null;
  createdAt: string;
  finishedAt: string | null;
  matches: MatchRecord[];
}

const p = (id: string, name: string, emoji: string): PersonaLite => ({
  id,
  name,
  avatar: { kind: "emoji", value: emoji },
});

const kyoto = p("per-1", "Kyoto in October", "⛩️");
const oaxaca = p("per-2", "Oaxaca in November", "💀");
const lisbon = p("per-3", "Lisbon, Alfama", "🌅");
const ljublj = p("per-4", "Ljubljana, Old Town", "🐉");
const aero = p("per-5", "Aero X1 Espresso", "☕");
const lumen = p("per-6", "Lumen Pour-Over", "🫖");
const trail = p("per-7", "TrailLite 40L Pack", "🎒");
const nomad = p("per-8", "Nomad Duffel 35", "🧳");

/** Demo history until accounts land; same shape the DB query returns. */
export const DEMO_TOURNAMENTS: TournamentSummary[] = [
  {
    id: "t-1",
    category: "places",
    bracketSize: 4,
    phase: "FINAL",
    winner: oaxaca,
    createdAt: "2026-09-17T21:04:00Z",
    finishedAt: "2026-09-17T21:11:30Z",
    matches: [
      { id: "m-1", round: 0, matchIndex: 0, entrantA: kyoto, entrantB: oaxaca, winnerId: "per-2", decidedAt: "2026-09-17T21:06:10Z" },
      { id: "m-2", round: 0, matchIndex: 1, entrantA: lisbon, entrantB: ljublj, winnerId: "per-3", decidedAt: "2026-09-17T21:08:05Z" },
      { id: "m-3", round: 1, matchIndex: 0, entrantA: oaxaca, entrantB: lisbon, winnerId: "per-2", decidedAt: "2026-09-17T21:11:30Z" },
    ],
  },
  {
    id: "t-2",
    category: "products",
    bracketSize: 4,
    phase: "ABANDONED",
    winner: null,
    createdAt: "2026-09-18T02:40:00Z",
    finishedAt: null,
    matches: [
      { id: "m-4", round: 0, matchIndex: 0, entrantA: aero, entrantB: lumen, winnerId: "per-5", decidedAt: "2026-09-18T02:42:20Z" },
      { id: "m-5", round: 0, matchIndex: 1, entrantA: trail, entrantB: nomad, winnerId: null, decidedAt: null },
    ],
  },
];
