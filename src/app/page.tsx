import { Suspense } from "react";
import Image from "next/image";
import RecentShows from "../components/RecentShows";
import Link from "next/link";
import Header from "../components/Header";
import LiveShowcase from "../components/LiveShowcase";

const STAGE_CATEGORIES = [
  {
    slug: "people",
    title: "People",
    blurb:
      "A date, a cofounder, an investor — tell the host who you're after and hear every candidate pitch themselves.",
    image: "/landing/stage-people.webp",
    alt: "Contestant pitching herself on a neon dating-show stage",
  },
  {
    slug: "places",
    title: "Places",
    blurb:
      "Your next trip, neighborhood, or venue takes the screen and makes its own case for you.",
    image: "/landing/stage-places.webp",
    alt: "Stage LED wall showing a coastal town at golden hour",
  },
  {
    slug: "products",
    title: "Products",
    blurb:
      "The thing you're shopping for steps into the spotlight — head to head until one wins you over.",
    image: "/landing/stage-products.webp",
    alt: "Sneaker under a spotlight on a neon product-reveal pedestal",
  },
] as const;

export default function Home() {
  return (
    <>
      <Header />
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 pb-14 pt-16 text-center">
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
            15 seconds to win <span className="brand-gradient-text">you</span> over.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted">
            Speed-matching you to what you want. You hear every pitch, you
            talk back, you pick the winner.
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

        <section id="stages" className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-center text-2xl font-bold">Pick your stage</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {STAGE_CATEGORIES.map(({ slug, title, blurb, image, alt }) => (
              <Link
                key={slug}
                href={`/stage/${slug}`}
                className="group overflow-hidden rounded-xl border border-card-border bg-card transition hover:border-brand-purple"
              >
                <div className="relative aspect-video overflow-hidden">
                  <Image
                    src={image}
                    alt={alt}
                    fill
                    sizes="(min-width: 768px) 33vw, 100vw"
                    className="object-cover transition duration-300 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />
                  <div className="absolute bottom-3 left-4 text-xl font-bold">
                    {title}
                  </div>
                </div>
                <p className="p-5 text-sm leading-relaxed text-muted">{blurb}</p>
              </Link>
            ))}
          </div>

          <div className="relative mt-6 overflow-hidden rounded-xl border border-card-border">
            <Image
              src="/landing/stage-duo.webp"
              alt="Studio wide shot: spotlit main stage beside a smaller side stage screen"
              width={1600}
              height={900}
              sizes="(min-width: 1152px) 1152px, 100vw"
              className="h-64 w-full object-cover sm:h-80"
            />
            <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-background/90 via-background/30 to-transparent p-6 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
              <div className="max-w-sm">
                <div className="text-lg font-bold">
                  <span className="brand-gradient-text">Main stage</span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  Take it and the show is yours — the host runs your bracket
                  live while everyone watches.
                </p>
              </div>
              <div className="mt-4 max-w-sm sm:mt-0 sm:text-right">
                <div className="text-lg font-bold">Side stage</div>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  Next in line warms up here — apply from chat and you&apos;re
                  seconds from the spotlight.
                </p>
              </div>
            </div>
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
