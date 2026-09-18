<p align="center">
  <a href="https://www.speedmatch.tv/pitch">
    <img src="src/app/icon.svg" alt="SpeedMatch.tv logo" width="120" height="120" />
  </a>
</p>

<h2 align="center"><a href="https://www.speedmatch.tv/pitch">Click to read our pitch deck</a></h2>

# SpeedMatch.tv — 15 seconds to win you over

**The world's first AI speed-dating game show.** Contestants aren't just people —
they're **People, Products, and Places**, each represented by a live AI voice
agent with its own face and voice. They get 15 seconds each, head to head, to
pitch why *you* should choose them. You talk back. You pick. Winners advance
through a knockout bracket until one champion remains — and the crowd watches
it all live.

Built in one day at **[Build an AI Startup in One Day](https://luma.com/oss4ai-fdvg)**
(Open Source for AI, San Francisco) for the **Voice AI track**, on
**Boson AI** voices and **InsForge/InstaCloud** infrastructure.

## Why it's fun (the game show loop)

1. **Start a session** — a host agent interviews you for a minute (voice,
   full duplex, you can interrupt it). That conversation becomes a typed
   profile: what you're looking for, your dealbreakers, your vibe.
2. **The bracket seeds** — four (or eight) contestants enter: a person who
   bikes every bridge in the city, a dutch oven with a fifty-year warranty,
   Kyoto at dawn. Every contestant gets a distinct Boson voice and a talking
   avatar tile.
3. **15-second pitches, enforced by the server** — each contestant pleads its
   case *to your specific profile*. The orchestrator — a game-show host with
   its own personality and avatar — keeps the pace brutal and the energy up.
4. **You talk back** — full-duplex speech via Higgs Realtime, with barge-in.
   Push back, flirt, cross-examine. Then you decide who advances.
5. **A champion emerges** — and the finished match gets a shareable summary
   title ("*The Dutch Oven That Beat Three Humans*"), so every tournament
   becomes a watchable, clickable story on the landing page.

Spectators can join any public session, watch the bracket live, and (roadmap)
feed the orchestrator crowd context from a live chatroom — the audience
becomes part of the show.

## The voice stack (Boson AI)

| Piece | What we use it for |
|---|---|
| **Higgs Realtime** (`wss://api.boson.ai/v1/realtime`) | The pitch legs and onboarding: full-duplex speech-to-speech with semantic turn detection and barge-in |
| **Higgs TTS-3** | The orchestrator's scripted game-show lines — six preset voices mapped to contestant archetypes (`jake` energetic consumer, `eleanor` premium calm, `nora` narrative places…) with emotion/prosody tags |
| **Higgs Avatar** | Streaming talking-head tiles: a contestant's photo, a product shot, or a postcard of Kyoto — talking to you in real time |
| **Voice registration** | Cloned contestant voices from onboarding audio — consent-gated, with a stored `voice_id` so consent revocation actually deletes the voice |

Browsers never see the Boson API key: an authenticated, thrice-rate-limited
token broker mints **90-second ephemeral client secrets** per pitch leg.

## The infrastructure story (InsForge / InstaCloud)

The whole product runs on one InstaCloud project — compute (this Next.js app),
managed Postgres, and secrets governance:

- **Branch-isolated environments**: every feature ships from an insta branch
  with its own copy-on-write database, storage, and compute clone. The
  backend skeleton in this repo was built and smoke-tested on a full
  disposable environment without ever touching production data.
- **Credential seam**: `BOSON_API_KEY` lives in `insta secrets`, reaches the
  container only through an explicit bind, and is never in git, `.env`, or
  the browser.
- **Agent-team development**: this repo is built by a team of AI agents
  (Claude Fable ×2, Claude Opus, Codex) coordinating over Buzz with humans
  Seth Caldwell and David Tilser — reviewed, adversarially re-reviewed, and
  deployed to production continuously during the hackathon.

## Engineering you can judge us on

- **Server-authoritative game state.** The tournament is a pure, serializable
  state machine (`server/src/tournament/machine.ts`): 15s legs are epoch-ms
  deadlines from the server clock, early timer events are rejected, decisions
  are phase-validated, and optimistic concurrency (`tournaments.version`)
  makes double-clicks and replays harmless. No model, no client, ever times
  or scores itself.
- **Honest outcomes.** A walked-away match becomes `ABANDONED` — we never
  fabricate a winner the user didn't pick.
- **Prompt-injection discipline.** Onboarding transcripts are extracted into
  a strict typed schema (unknown keys rejected, control tokens stripped —
  including invisible Unicode tag characters), shared fields are
  user-approved allowlists, and nothing reaches a TTS input without
  sanitization.
- **Privacy by default.** Public feeds show only consented pseudonyms and
  capped snippets; sessions are private unless opted in; voice cloning is
  consent-flagged with a revocation handle.

## Stack

Next.js 16 (App Router, TypeScript, Tailwind v4), standalone Docker image on
port **3000**. Backend core (state machine, Boson token broker, migrations)
lives in `server/` as a zero-runtime-dependency npm workspace. Import shared
helpers through its declared exports (for example `@speedmatch/server/onboarding`),
not relative paths into `server/src`. The root lockfile owns both packages.

## Develop

```bash
npm ci            # installs the app and server workspace from the root lockfile
npm run dev        # http://localhost:3000
npm run build && npm run lint
npm test
npm test --workspace @speedmatch/server
npm run typecheck --workspace @speedmatch/server
```

## Deploy (InstaCloud)

Project `c7b44dea-0aa3-43b6-a796-ce510ac13c3e`, compute service `web`.
Develop on an insta branch, then promote — never develop straight on main:

```bash
insta --agent branch create <feature>
insta --agent deploy . --group web --port 3000
```

DNS is Route53 (zone `Z0550806TJYCD5L1YCK`); `www.speedmatch.tv` CNAMEs to
`prod-use1.instacloud-dns.com`.

Secrets (e.g. `BOSON_API_KEY`) are bound with `insta secrets bind` — never
committed, never in `.env` files, never sent to the browser.

## Team

Seth Caldwell · David Tilser · and an AI agent crew: Claude-Fable (backend,
infra, release), Claude-Fable-Laptop (product UI), Claude-Opus (security
review), Bartolomej Codex (onboarding boundary).

## Public recaps and Recent shows

`/watch/[tournamentId]` renders the denormalized `matches` rows, with a winner
spotlight and a 1200×630 branded card at `/watch/[tournamentId]/share-image`.
These are bracket recaps; they do not imply recorded audio/video playback.
The homepage shows up to six newest public, finished tournaments.

The server fetcher in `src/lib/public-tournaments.ts` expects:

- `GET /api/tournaments/public` → `{ tournaments: [...] }`. Each entry is
  `TournamentSummary` from `src/lib/matches.ts` without `matches`, plus
  `isPublic: true` and `summaryTitle: string | null`.
- `GET /api/tournaments/[id]/matches` → `{ tournament: ... }` with the same
  fields and the `matches` array included.

Both API queries must filter `is_public = true` and terminal `FINAL` in SQL.
Private, unfinished, missing and malformed UUIDs must share a 404 response.
The renderer also rejects nonpublic/nonfinal payloads and never uses
`tournaments.state.rounds`, account names, or onboarding transcripts. Names
and titles pass through the backend's shared `stripSpeechControlTokens`
implementation before page, card and metadata rendering.

Requests use `no-store`, a five-second timeout, and no user cookies. The default
API origin is `http://127.0.0.1:${PORT || 3000}` for the same compute service.
Set the server-only `TOURNAMENT_API_ORIGIN` when the API runs elsewhere (or to
a local fixture API for testing). Never derive it from request Host headers.
Canonical/share links use `https://www.speedmatch.tv`, the current TLS-ready
canonical host. API outages show an unavailable state, not fictional results.

External avatar images require `PUBLIC_AVATAR_HOSTS`, a comma-separated list
of exact HTTPS hosts (including port if nonstandard). Unlisted images receive
a neutral glyph; local asset paths are accepted and streams show a placeholder.
The API must also validate image hosts before publishing them.

Validation: `npm test`, `npm run lint`, `npm run build`; the backend keeps its
own `npm --prefix server test` and `npm --prefix server run typecheck` checks.
