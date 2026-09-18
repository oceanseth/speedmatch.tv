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
lives in `server/` as a zero-runtime-dependency package.

## Develop

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm run lint
cd server && npm test   # backend suite
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
