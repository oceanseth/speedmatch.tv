export type Category = "people" | "products" | "places";

export interface Avatar {
  /** "emoji" today; "image" for stills, "stream" once Higgs Avatar tiles land. */
  kind: "emoji" | "image" | "stream";
  value: string;
}

export interface Contestant {
  name: string;
  avatar: Avatar;
  /** Public broadcast text; capped server-side at PITCH_SNIPPET_MAX chars. */
  pitchSnippet: string;
}

export interface LiveSession {
  id: string;
  matchId: string;
  category: Category;
  contestants: [Contestant, Contestant];
  nowPitchingIndex: 0 | 1;
  /** 0-based round within the bracket. */
  roundIndex: number;
  totalRounds: number;
  /** Epoch ms when the current 15s pitch leg ends (maps to the state machine's deadlineAt). */
  legEndsAt: number;
  /** Consented display pseudonym — never an account name. */
  seeker: string;
  viewers: number;
  /** The public feed only ever contains sessions where this is true. */
  isPublic: true;
}

export interface LiveSessionsResponse {
  /** Server clock at serialization time; clients derive an offset from it. */
  serverNow: number;
  sessions: LiveSession[];
}

export const PITCH_LEG_MS = 15_000;
export const PITCH_SNIPPET_MAX = 140;

export function roundLabel(roundIndex: number, totalRounds: number): string {
  const remaining = totalRounds - roundIndex;
  if (remaining <= 1) return "Final";
  if (remaining === 2) return "Semifinal";
  if (remaining === 3) return "Quarterfinal";
  return `Round ${roundIndex + 1}`;
}
