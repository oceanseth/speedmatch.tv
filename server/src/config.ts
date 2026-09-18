/**
 * Tunables for the speed-match tournament. Everything the team flagged as
 * "default until Seth/David answer" lives here so flipping an answer is a
 * one-line change.
 */
export const config = {
  /** Entrants per tournament. Must be a power of two. Pending answer: 4 or 8. */
  bracketSize: 4,
  /** Hard server-side cap on each pitch leg, per product spec. */
  pitchSeconds: 15,
  /** Time the user gets to talk back after both pitches. */
  userResponseSeconds: 20,
  /** Time the user gets to pick A or B before the orchestrator nudges. */
  decideSeconds: 15,
  /** Ephemeral Boson client secrets: long enough for one leg, no longer. */
  clientSecretSeconds: 90,
  /** Token-broker rate limit: mints per user per minute. */
  tokenMintsPerMinute: 10,
} as const;

export type Category = 'people' | 'products' | 'places';
export const CATEGORIES: readonly Category[] = ['people', 'products', 'places'];
