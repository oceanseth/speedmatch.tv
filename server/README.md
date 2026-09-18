# @speedmatch/server — backend skeleton

Framework-agnostic backend core for the speed-match tournament, built to drop
into the Next.js app as a workspace package (or copy `src/` into the app —
there are zero runtime dependencies).

## What's here

- `src/tournament/machine.ts` — pure, serializable, server-authoritative
  tournament state machine:
  `LOBBY → ONBOARD → SEED → [PITCH_A 15s → PITCH_B 15s → USER_RESPONSE → DECIDE] × N → FINAL`.
  Timed phases carry epoch-ms deadlines; early `TIMER_EXPIRED` throws. State is
  plain JSON — persist it in `tournaments.state`.
- `src/boson/tokenBroker.ts` — mints ephemeral Higgs Realtime client secrets
  (`POST /v1/realtime/client_secrets`). `createTokenBrokerHandler` is a
  Web-standard `Request → Response` function, so in the App Router it's just:

  ```ts
  // app/api/realtime/token/route.ts
  import { createTokenBrokerHandler } from '@speedmatch/server/boson';
  export const POST = createTokenBrokerHandler({ authorize: yourSessionCheck });
  ```

  `BOSON_API_KEY` is read server-side only. Per-user rate limit, opaque errors,
  90s expiry default (`server/src/config.ts`).
- `src/config.ts` — the "defaults until Seth/David answer" knobs: bracket size
  (4), pitch seconds (15), auth-light assumptions.
- `../migrations/*.sql` — postgres schema (users, typed onboarding profiles
  with a redacted `public_summary` for what pitching agents/spectators may see,
  personas catalog with Boson voice mapping, tournaments + denormalized
  matches for the My Matches tab, append-only `session_events` for spectator
  catch-up/replay) and a 12-persona seed catalog across People/Products/Places.

## Transport-layer contract (not implemented here, by design)

The WS/route layer that mounts this must enforce:
1. Ownership: only the tournament's owner may send `USER_DECISION` or mint a
   speaking token. Spectators are read-only. The broker's `authorize` now
   returns `{ userId, tournamentId }` — verifying that pair against the
   `tournaments` row is the mount point's job; a valid login alone is not
   enough.
2. Optimistic concurrency on every event application:
   `UPDATE tournaments SET state = $new, version = version + 1 WHERE id = $id
   AND version = $expected` — reject on zero rows. Double-clicks and
   reconnect replays otherwise race `advance()` and skip matches. Use the new
   version as `session_events.seq` so the events PK also serializes appends.
3. Drive `TIMER_EXPIRED` from a server timer using `msRemaining()`.
4. Append every transition to `session_events`, including `TOKEN_MINTED` via
   the broker's `onMint` hook.
5. Extract onboarding transcript into the structured profile below and validate
   it with `parseOnboardingProfile`. Store only validated output. Strip speech
   control tokens from other untrusted text with `stripSpeechControlTokens`.
6. The public live feed queries `WHERE is_public` only (default false), and
   shows a consented display pseudonym — never the account name.

## Onboarding profile boundary

`@speedmatch/server/onboarding` is a zero-dependency validation and prompt-context
helper. The extraction model and authenticated HTTP/storage layer are supplied by
the app. Its version-1 JSON schema is:

```ts
{
  version: 1,
  category: 'people' | 'products' | 'places',
  goal: string,          // required, 1–280 UTF-16 code units
  interests: string[],   // required, 0–8 entries, each 1–120 code units
  preferences: string[], // same limits
  dealbreakers: string[] // same limits
}
```

Unknown fields and invalid types are rejected, never coerced. Length limits
apply before normalization. Control tags, residual tag delimiters and invisible
control characters are removed; whitespace is normalized and lists deduplicated.
Unicode Tags (U+E0000–U+E007F) and both variation-selector blocks
(U+FE00–U+FE0F, U+E0100–U+E01EF) are removed before control-tag parsing.
This can change emoji or ideograph presentation while preserving base characters.
Raw transcripts, identity, voice-cloning consent and public-sharing consent do
not belong in model output. Capture consent independently from the authenticated
user; leave `voice_consent` false unless explicitly granted.

```ts
import {
  parseOnboardingProfile, buildPublicSummary, buildPitchContext,
} from '@speedmatch/server/onboarding';

const profile = parseOnboardingProfile(extractedJson);
// Default summary includes only version/category, no free-text fields.
const privateByDefault = buildPublicSummary(profile);
// After the user reviews these exact normalized values and approves sharing:
const publicSummary = buildPublicSummary(profile, ['goal', 'interests']);
const context = buildPitchContext(publicSummary);
```

Save `profile` and `publicSummary` to `onboarding_profiles.profile` and
`public_summary`. Approved fields must come from the user's explicit review,
not the extraction model. Reconfirm after values change. A field allowlist is
**not automatic PII redaction**: even a goal may contain an email or other private
detail. Show that the chosen values can be spoken aloud before approval.
Session broadcasting (`isPublic`) requires separate consent.

Load the approved summary from server-owned storage before building pitch
context; do not accept a client-provided summary as proof of approval.
The fixed template treats serialized values as data. It does not make arbitrary
text immune to prompt injection. Keep authorization, timing, tool permissions
and bracket decisions enforced in server code. Apply request-body size limits
before JSON parsing; this module bounds individual fields after parsing.
At the TTS request boundary, also sanitize every untrusted name, tagline or other
value interpolated into speech input. Profile validation alone does not cover
those other sources. A speech API wrapper is not implemented in this module.

## Run migrations (InstaCloud branch DB)

```bash
psql "$(insta --agent db url --branch <branch>)" -f migrations/001_init.sql
psql "$(insta --agent db url --branch <branch>)" -f migrations/002_seed_personas.sql
```

## Tests

```bash
cd server && npm install && npm test && npm run typecheck
```
