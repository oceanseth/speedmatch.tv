import type { Avatar, Category } from "./types";

/**
 * Client contract for the live stage. Mirrors the shapes proposed to the
 * backend session in-channel (2026-09-18): stage/queue snapshot, the
 * session_events poll (with a full TournamentState snapshot so the bracket
 * renders without client-side event replay), chat riding session_events,
 * and the click fallback for USER_DECISION. State shapes mirror
 * server/src/tournament/machine.ts on backend-skeleton. If the backend
 * lands with a different shape, only this module changes — every panel
 * renders an honest offline/empty state on a failed fetch, no demo data.
 */

export type Phase =
  | "LOBBY"
  | "ONBOARD"
  | "SEED"
  | "PITCH_A"
  | "PITCH_B"
  | "USER_RESPONSE"
  | "DECIDE"
  | "FINAL"
  | "ABANDONED";

export interface BracketMatch {
  round: number;
  index: number;
  entrantA: string | null;
  entrantB: string | null;
  winner: string | null;
}

export interface TournamentStateSnapshot {
  phase: Phase;
  bracketSize: number;
  entrants: string[];
  /** rounds[r][i]; round 0 first. */
  rounds: BracketMatch[][];
  current: { round: number; index: number } | null;
  /** Epoch ms deadline for the current timed phase, else null. */
  deadlineAt: number | null;
  winner: string | null;
}

export interface StageSlot {
  tournamentId: string;
  /** Consented display pseudonym — never an account name. */
  seeker: string;
  phase: Phase;
  startedAt: number;
}

export interface QueueEntry {
  position: number;
  displayName: string;
}

export interface StageSnapshot {
  serverNow: number;
  main: StageSlot | null;
  side: StageSlot | null;
  queue: QueueEntry[];
}

export interface SessionEvent {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface PersonaCard {
  name: string;
  avatar: Avatar;
}

export interface EventsResponse {
  serverNow: number;
  state: TournamentStateSnapshot;
  events: SessionEvent[];
  /** Optional entrant-id → card map; ids render abbreviated without it. */
  personas?: Record<string, PersonaCard>;
}

export type Fetched<T> = { ok: true; data: T } | { ok: false };

async function getJson<T>(url: string): Promise<Fetched<T>> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { ok: false };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false };
  }
}

async function postJson<T>(url: string, body: unknown): Promise<Fetched<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false };
  }
}

export function fetchStage(category: Category): Promise<Fetched<StageSnapshot>> {
  return getJson(`/api/stage/${category}`);
}

export function applyForStage(
  category: Category,
  displayName: string,
): Promise<Fetched<{ position: number }>> {
  return postJson(`/api/stage/${category}/apply`, { displayName });
}

export function fetchEvents(
  tournamentId: string,
  sinceSeq: number,
): Promise<Fetched<EventsResponse>> {
  return getJson(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/events?since=${sinceSeq}`,
  );
}

export function postChat(
  tournamentId: string,
  text: string,
): Promise<Fetched<{ seq: number }>> {
  return postJson(`/api/tournaments/${encodeURIComponent(tournamentId)}/chat`, {
    text,
  });
}

/**
 * Click fallback for the voice decision. The transport layer enforces
 * owner-only USER_DECISION server-side; hiding the buttons from
 * spectators here is presentation, not security.
 */
export function postDecision(
  tournamentId: string,
  winner: "A" | "B",
): Promise<Fetched<{ phase: Phase }>> {
  return postJson(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/decision`,
    { winner },
  );
}

export const PHASE_LABELS: Record<Phase, string> = {
  LOBBY: "Waiting to start",
  ONBOARD: "Onboarding interview",
  SEED: "Seeding the bracket",
  PITCH_A: "Pitch — contestant A",
  PITCH_B: "Pitch — contestant B",
  USER_RESPONSE: "Seeker responds",
  DECIDE: "Picking a winner",
  FINAL: "Winner crowned",
  ABANDONED: "Session ended",
};

/** Phases where a specific match is on stage and contestant tiles render. */
export const MATCH_PHASES: readonly Phase[] = [
  "PITCH_A",
  "PITCH_B",
  "USER_RESPONSE",
  "DECIDE",
];
