export type Category = "people" | "products" | "places";

export interface LiveSession {
  id: string;
  category: Category;
  /** Display name of the contestant currently pitching. */
  contestant: string;
  /** Short live snippet of the pitch in progress. */
  pitchSnippet: string;
  /** e.g. "Quarterfinal", "Semifinal", "Final" */
  round: string;
  /** Seconds remaining in the current 15s pitch leg. */
  secondsLeft: number;
  /** Who the contestants are pitching to. */
  seeker: string;
  viewers: number;
  /** Emoji stand-in for the avatar tile until Higgs Avatar streams land. */
  emoji: string;
}

export interface LiveSessionsResponse {
  sessions: LiveSession[];
}
