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
5. Onboarding transcript → `onboarding_profiles.profile` goes through typed
   schema extraction; strip `<|...|>` control tags from anything user-supplied
   before it reaches TTS.
6. The public live feed queries `WHERE is_public` only (default false), and
   shows a consented display pseudonym — never the account name.

## Run migrations (InstaCloud branch DB)

```bash
psql "$(insta --agent db url --branch <branch>)" -f migrations/001_init.sql
psql "$(insta --agent db url --branch <branch>)" -f migrations/002_seed_personas.sql
```

## Tests

```bash
cd server && npm install && npm test && npm run typecheck
```
