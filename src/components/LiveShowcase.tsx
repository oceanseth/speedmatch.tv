"use client";

import { useEffect, useState } from "react";
import type { Category, LiveSession, LiveSessionsResponse } from "../lib/types";

const CATEGORIES: { key: Category; title: string; tagline: string }[] = [
  { key: "people", title: "People", tagline: "Real humans, 15 seconds to shine" },
  { key: "products", title: "Products", tagline: "Things that pitch themselves" },
  { key: "places", title: "Places", tagline: "Destinations that want you there" },
];

function SessionCard({ session }: { session: LiveSession }) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-4 transition hover:border-brand-purple/60">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-background text-2xl">
          {session.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{session.contestant}</span>
            <span className="flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-400">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-red-400" />
              Live
            </span>
          </div>
          <div className="text-xs text-muted">
            {session.round} · pitching to {session.seeker} · {session.viewers}{" "}
            watching
          </div>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 text-sm italic text-muted">
        “{session.pitchSnippet}”
      </p>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-background">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-pink to-brand-purple transition-all duration-1000 ease-linear"
              style={{ width: `${(session.secondsLeft / 15) * 100}%` }}
            />
          </div>
          <span className="font-mono text-xs text-muted">
            {session.secondsLeft}s
          </span>
        </div>
        <button
          type="button"
          className="rounded-full border border-card-border px-3 py-1 text-xs font-medium text-foreground transition hover:border-brand-pink"
        >
          Watch
        </button>
      </div>
    </div>
  );
}

export default function LiveShowcase() {
  const [sessions, setSessions] = useState<LiveSession[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/live-sessions", { cache: "no-store" });
        if (!res.ok) return;
        const data: LiveSessionsResponse = await res.json();
        if (!cancelled) setSessions(data.sessions);
      } catch {
        // demo feed; stale cards are fine
      }
    };
    load();
    const t = setInterval(load, 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <section id="live" className="mx-auto w-full max-w-6xl px-4 pb-20">
      <div className="grid gap-8 md:grid-cols-3">
        {CATEGORIES.map((cat) => (
          <div key={cat.key}>
            <h2 className="text-lg font-bold">
              <span className="brand-gradient-text">{cat.title}</span>
            </h2>
            <p className="mb-4 text-sm text-muted">{cat.tagline}</p>
            <div className="flex flex-col gap-4">
              {sessions
                .filter((s) => s.category === cat.key)
                .map((s) => (
                  <SessionCard key={s.id} session={s} />
                ))}
              {sessions.length === 0 && (
                <div className="rounded-xl border border-dashed border-card-border p-6 text-center text-sm text-muted">
                  Loading live sessions…
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
