import type { Metadata } from "next";
import PitchDeck from "./PitchDeck";

export const metadata: Metadata = {
  title: "SpeedMatch.tv — Hackathon Pitch",
  description: "A voice game show for choosing people, products and places. A hackathon prototype by Seth Caldwell and David Tilser.",
  alternates: { canonical: "https://www.speedmatch.tv/pitch" },
  openGraph: {
    title: "SpeedMatch.tv — 15 seconds to win you over",
    description: "Hear the pitch. Talk back. Pick your match.",
    url: "https://www.speedmatch.tv/pitch",
    type: "website",
  },
};

export default function PitchPage() { return <PitchDeck />; }
