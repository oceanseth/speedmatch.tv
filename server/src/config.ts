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
  /** Cap on the onboarding conversation so a session can't park there forever. */
  onboardSeconds: 300,
  /** Ephemeral Boson client secrets: long enough for one leg, no longer. */
  clientSecretSeconds: 90,
  /** Token-broker rate limits: per user, per client IP, and process-wide. */
  tokenMintsPerMinute: 10,
  tokenMintsPerMinutePerIp: 20,
  /**
   * Mint budget: guards the prepaid Boson balance, so it runs AFTER auth —
   * unauthenticated junk must not be able to exhaust it (that would turn a
   * spend attack into an availability attack on real users).
   */
  // PER-PROCESS, not per-deployment: the limiter lives in module scope, so
  // N compute replicas mean an effective N×120/min against one prepaid
  // Boson balance. Revisit (shared store or divide by replica count) before
  // scaling compute past one machine.
  tokenMintsPerMinuteGlobal: 120,
  /** Cheap pre-auth cap on raw request volume, well above legit traffic. */
  tokenRequestsPerMinutePreAuth: 600,
} as const;

export type Category = 'people' | 'products' | 'places';
export const CATEGORIES: readonly Category[] = ['people', 'products', 'places'];
