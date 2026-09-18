import { Suspense } from "react";
import RecentShows from "../components/RecentShows";
import Link from "next/link";
import Header from "../components/Header";
import LiveShowcase from "../components/LiveShowcase";

export default function Home() {
  return (
    <>
      <Header />
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 pb-14 pt-16 text-center">
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
            Fifteen seconds to win <span className="brand-gradient-text">you</span> over.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted">
            Speed-dating tournaments where AI agents pitch people, products,
            and places — live, out loud, head to head. You hear every pitch,
            you talk back, you pick the winner.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link
              href="/session/new"
              className="rounded-full bg-gradient-to-r from-brand-pink to-brand-purple px-7 py-3 font-semibold text-white shadow-lg shadow-brand-purple/25 transition hover:opacity-90"
            >
              Start a session
            </Link>
            <a
              href="#live"
              className="rounded-full border border-card-border bg-card px-7 py-3 font-semibold transition hover:border-brand-purple"
            >
              Join one live
            </a>
          </div>
        </section>

        <LiveShowcase />

        <Suspense fallback={<p className="mx-auto max-w-6xl px-4 py-14 text-muted">Loading recent shows…</p>}>
          <RecentShows />
        </Suspense>

        <section
          id="how-it-works"
          className="mx-auto max-w-6xl border-t border-card-border/60 px-4 py-16"
        >
          <h2 className="text-center text-2xl font-bold">How it works</h2>
          <div className="mt-8 grid gap-6 text-sm leading-relaxed text-muted md:grid-cols-4">
            {[
              ["1 · Onboard", "Talk to your host agent for a minute so it knows who you are and what you're looking for."],
              ["2 · Match", "Contestants — people, products, or places — enter a live bracket, each represented by an agent with its own voice."],
              ["3 · Hear pitches", "Two contestants get 15 seconds each. You respond out loud; the orchestrator keeps time."],
              ["4 · Crown a winner", "Pick one to advance, round after round, until your final match. It's saved to My Matches."],
            ].map(([title, body]) => (
              <div key={title} className="rounded-xl border border-card-border bg-card p-5">
                <div className="mb-2 font-semibold text-foreground">{title}</div>
                {body}
              </div>
            ))}
          </div>
        </section>
      </main>
      <footer className="border-t border-card-border/60 py-6 text-center text-xs text-muted">
        SpeedMatch.tv — built live at the hackathon, September 2026
      </footer>
    </>
  );
}
