import { NextResponse } from "next/server";
import type { LiveSession } from "../../../lib/types";

// Demo data shaped exactly like the real session feed will be, so the
// backend swap is a one-line change in the client. Snippets rotate and
// timers drift so the landing page reads as live.
const SEED: Omit<LiveSession, "secondsLeft" | "viewers">[] = [
  {
    id: "p1",
    category: "people",
    contestant: "Maya R.",
    pitchSnippet:
      "…I'm the only person you'll meet who's biked every bridge in the city — Saturday, you in?",
    round: "Semifinal",
    seeker: "Jordan",
    emoji: "🚴‍♀️",
  },
  {
    id: "p2",
    category: "people",
    contestant: "Dev K.",
    pitchSnippet:
      "…fifteen seconds is all I need: I cook, I listen, and I never lose at trivia night.",
    round: "Quarterfinal",
    seeker: "Sam",
    emoji: "🍳",
  },
  {
    id: "pr1",
    category: "products",
    contestant: "Aero X1 Espresso",
    pitchSnippet:
      "…nine bars of pressure, zero counter space. Your mornings deserve better than pods.",
    round: "Final",
    seeker: "Alexis",
    emoji: "☕",
  },
  {
    id: "pr2",
    category: "products",
    contestant: "TrailLite 40L Pack",
    pitchSnippet:
      "…I weigh less than your laptop and I've summited Rainier twice this month.",
    round: "Quarterfinal",
    seeker: "Marcus",
    emoji: "🎒",
  },
  {
    id: "pl1",
    category: "places",
    contestant: "Kyoto in October",
    pitchSnippet:
      "…maple leaves over the Kamo river, and I promise the matcha is worth the flight.",
    round: "Semifinal",
    seeker: "Priya",
    emoji: "⛩️",
  },
  {
    id: "pl2",
    category: "places",
    contestant: "Lisbon, Alfama",
    pitchSnippet:
      "…fado drifting uphill at dusk. Choose me and bring comfortable shoes.",
    round: "Quarterfinal",
    seeker: "Chris",
    emoji: "🌅",
  },
];

export function GET() {
  const now = Date.now();
  const sessions: LiveSession[] = SEED.map((s, i) => ({
    ...s,
    // Deterministic per-second drift keeps the page feeling live without
    // needing server state.
    secondsLeft: 15 - (Math.floor(now / 1000) + i * 5) % 15,
    viewers: 12 + ((Math.floor(now / 10000) + i * 7) % 48),
  }));
  return NextResponse.json({ sessions });
}
