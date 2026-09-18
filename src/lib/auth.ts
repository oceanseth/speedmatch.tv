import { betterAuth } from "better-auth";
import { getPool } from "./db";

// Minimal account layer (channel decision 2026-09-18: David wants real login
// now; Better Auth is the repo-blessed library). Email + password + display
// name only — social providers, verification emails, and 2FA are later
// opt-ins. Sessions live in postgres via the shared pool; the auth tables
// come from migrations/005_better_auth.sql (same replay discipline as every
// other schema change).
//
// BETTER_AUTH_SECRET and BETTER_AUTH_URL come from InstaCloud secrets — no
// fallbacks here on purpose: booting without them should fail loudly, not
// mint sessions with a guessable secret.
export const auth = betterAuth({
  appName: "SpeedMatch.tv",
  database: getPool(),
  emailAndPassword: {
    enabled: true,
    // No email infrastructure yet — verification would lock everyone out.
    requireEmailVerification: false,
  },
  rateLimit: {
    // In-memory (per-process) — same caveat as the token broker's global
    // budget; revisit before scaling compute past one machine.
    enabled: true,
  },
});

export type Session = typeof auth.$Infer.Session;
