# SpeedMatch.tv

Live speed-dating tournaments where AI agents pitch **people, products, and
places** — 15-second pitches, head to head, and you pick the winner.

## Stack

Next.js 16 (App Router, TypeScript, Tailwind v4), built as a standalone
Docker image serving on port **3000**. Backend services (tournament state
machine, Boson token broker, postgres migrations) live in `server/`.

## Develop

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm run lint
```

## Deploy (InstaCloud)

Project `c7b44dea-0aa3-43b6-a796-ce510ac13c3e`, compute service `web`.
Develop on an insta branch, then promote — never deploy straight to main:

```bash
insta --agent branch create <feature>
insta --agent deploy . --group web --port 3000
```

DNS is Route53 (zone `Z0550806TJYCD5L1YCK`); `www.speedmatch.tv` CNAMEs to
`prod-use1.instacloud-dns.com`.

Secrets (e.g. `BOSON_API_KEY`) are bound with `insta secrets bind` — never
committed, never in `.env` files, never sent to the browser.
