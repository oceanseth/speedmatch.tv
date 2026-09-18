import { betterAuth } from "better-auth";
import { stripSpeechControlTokens } from "@speedmatch/server/onboarding";
import { getPool } from "./db";

const MAX_NAME_CHARS = 40;

// Display names render in the header today and get SPOKEN once ownership
// links accounts to tournaments — so the TTS boundary applies at this door
// too, no matter how the value arrives (UI or a direct POST to
// /api/auth/sign-up/email). All-control-token names collapse to "Guest"
// rather than an empty string.
function cleanDisplayName(name: unknown): string {
  const cleaned = stripSpeechControlTokens(String(name ?? ""))
    .slice(0, MAX_NAME_CHARS)
    .trim();
  return cleaned || "Guest";
}

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
// Note (accepted for tonight): Better Auth holds the raw pool, so the first
// sign-in after a DB suspend can fail where public pages transparently
// retry (db.ts query() wrapper). Retry-on-cold-start for auth means teaching
// the adapter — revisit with the ownership work.
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
  advanced: {
    ipAddress: {
      // Without this, Better Auth's default reads x-forwarded-for, refuses
      // multi-hop values (returns null with no trustedProxies), and every
      // visitor collapses into ONE rate-limit bucket per path in prod — the
      // same shared-key failure the token broker guards against.
      // CF-Connecting-IP is trustworthy here: both ingress paths transit
      // Cloudflare and client-typed copies are rejected at their edge
      // (verified empirically — see tokenBroker.ts). x-forwarded-for stays
      // as the single-hop local/dev fallback.
      ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: { ...user, name: cleanDisplayName(user.name) },
        }),
      },
      update: {
        before: async (user) =>
          "name" in user && user.name !== undefined
            ? { data: { ...user, name: cleanDisplayName(user.name) } }
            : { data: user },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
