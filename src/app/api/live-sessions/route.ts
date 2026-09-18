import { NextResponse } from "next/server";
import {
  PITCH_LEG_MS,
  PITCH_SNIPPET_MAX,
  type Contestant,
  type LiveSession,
  type LiveSessionsResponse,
} from "../../../lib/types";

export const dynamic = "force-dynamic";

// Demo data shaped exactly like the real session feed will be, so the
// backend swap is a drop-in. Legs cycle deterministically off the clock;
// no server state needed.
type SeedMatch = Omit<
  LiveSession,
  "legEndsAt" | "nowPitchingIndex" | "viewers" | "isPublic"
>;

const c = (name: string, emoji: string, pitchSnippet: string): Contestant => ({
  name,
  avatar: { kind: "emoji", value: emoji },
  pitchSnippet,
});

const SEED: SeedMatch[] = [
  {
    id: "s-p1",
    matchId: "m-p1",
    category: "people",
    contestants: [
      c("Maya R.", "🚴‍♀️", "…I'm the only person you'll meet who's biked every bridge in the city — Saturday, you in?"),
      c("Dev K.", "🍳", "…fifteen seconds is all I need: I cook, I listen, and I never lose at trivia night."),
    ],
    roundIndex: 0,
    totalRounds: 2,
    seeker: "Jordan",
  },
  {
    id: "s-p2",
    matchId: "m-p2",
    category: "people",
    contestants: [
      c("Ana L.", "🎸", "…I write songs about strangers on trains. Pick me and I'll finally write a happy one."),
      c("Theo M.", "🔭", "…I know where to stand in this city to see Saturn's rings. Tonight, if you want."),
    ],
    roundIndex: 1,
    totalRounds: 2,
    seeker: "Sam",
  },
  {
    id: "s-pr1",
    matchId: "m-pr1",
    category: "products",
    contestants: [
      c("Aero X1 Espresso", "☕", "…nine bars of pressure, zero counter space. Your mornings deserve better than pods."),
      c("Lumen Pour-Over", "🫖", "…slow is the point. Three minutes of ritual beats nine bars of noise."),
    ],
    roundIndex: 1,
    totalRounds: 2,
    seeker: "Alexis",
  },
  {
    id: "s-pr2",
    matchId: "m-pr2",
    category: "products",
    contestants: [
      c("TrailLite 40L Pack", "🎒", "…I weigh less than your laptop and I've summited Rainier twice this month."),
      c("Nomad Duffel 35", "🧳", "…zippers that survive baggage handlers. Ask my last three owners — oh wait, still the first."),
    ],
    roundIndex: 0,
    totalRounds: 2,
    seeker: "Marcus",
  },
  {
    id: "s-pl1",
    matchId: "m-pl1",
    category: "places",
    contestants: [
      c("Kyoto in October", "⛩️", "…maple leaves over the Kamo river, and I promise the matcha is worth the flight."),
      c("Oaxaca in November", "💀", "…marigolds, mole negro, and a festival that treats memory as a party."),
    ],
    roundIndex: 0,
    totalRounds: 2,
    seeker: "Priya",
  },
  {
    id: "s-pl2",
    matchId: "m-pl2",
    category: "places",
    contestants: [
      c("Lisbon, Alfama", "🌅", "…fado drifting uphill at dusk. Choose me and bring comfortable shoes."),
      c("Ljubljana, Old Town", "🐉", "…small enough to walk, strange enough to stay. My dragons are on the bridge."),
    ],
    roundIndex: 1,
    totalRounds: 2,
    seeker: "Chris",
  },
];

export function GET() {
  const now = Date.now();
  const sessions: LiveSession[] = SEED.map((s, i) => {
    // Stagger matches so legs don't all flip at once; alternate the
    // pitching contestant each leg.
    const phase = now + i * 5_000;
    const legNumber = Math.floor(phase / PITCH_LEG_MS);
    return {
      ...s,
      contestants: s.contestants.map((ct) => ({
        ...ct,
        pitchSnippet: ct.pitchSnippet.slice(0, PITCH_SNIPPET_MAX),
      })) as [Contestant, Contestant],
      nowPitchingIndex: (legNumber % 2) as 0 | 1,
      legEndsAt: (legNumber + 1) * PITCH_LEG_MS - i * 5_000,
      viewers: 12 + ((Math.floor(now / 10_000) + i * 7) % 48),
      isPublic: true,
    };
  });
  const body: LiveSessionsResponse = { serverNow: now, sessions };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
