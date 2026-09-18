"use client";

import { useEffect, useState } from "react";
import {
  PITCH_LEG_MS,
  roundLabel,
  type Category,
  type Contestant,
  type LiveSession,
  type LiveSessionsResponse,
} from "../lib/types";

const POLL_MS = 8_000;
const POLL_MAX_MS = 60_000;

const CATEGORIES: { key: Category; title: string; tagline: string }[] = [
  { key: "people", title: "People", tagline: "Real humans, 15 seconds to shine" },
  { key: "products", title: "Products", tagline: "Things that pitch themselves" },
  { key: "places", title: "Places", tagline: "Destinations that want you there" },
];

function ContestantRow({
  contestant,
  pitching,
}: {
  contestant: Contestant;
  pitching: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition ${
        pitching ? "bg-background" : "opacity-50"
      }`}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-card text-xl">
        {contestant.avatar.kind === "emoji" ? (
          contestant.avatar.value
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={contestant.avatar.value}
            alt=""
            className="h-9 w-9 rounded-md object-cover"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{contestant.name}</span>
          {pitching && (
            <span className="flex items-center gap-1 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-400">
              <span className="live-dot h-1 w-1 rounded-full bg-red-400" />
              Pitching
            </span>
          )}
        </div>
        {pitching && (
          <p className="truncate text-xs italic text-muted">
            “{contestant.pitchSnippet}”
          </p>
        )}
      </div>
    </div>
  );
}

function SessionCard({
  session,
  msLeft,
}: {
  session: LiveSession;
  msLeft: number;
}) {
  const secondsLeft = Math.max(0, Math.ceil(msLeft / 1000));
  return (
    <div className="rounded-xl border border-card-border bg-card p-3 transition hover:border-brand-purple/60">
      <div className="mb-2 flex items-center justify-between text-xs text-muted">
        <span>
          {roundLabel(session.roundIndex, session.totalRounds)} · pitching to{" "}
          {session.seeker}
        </span>
        <span>{session.viewers} watching</span>
      </div>
      <div className="flex flex-col gap-1">
        <ContestantRow
          contestant={session.contestants[0]}
          pitching={session.nowPitchingIndex === 0}
        />
        <div className="py-0.5 text-center text-[10px] font-bold uppercase tracking-widest text-muted">
          vs
        </div>
        <ContestantRow
          contestant={session.contestants[1]}
          pitching={session.nowPitchingIndex === 1}
        />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-background">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-pink to-brand-purple"
              style={{
                width: `${Math.min(100, (msLeft / PITCH_LEG_MS) * 100)}%`,
              }}
            />
          </div>
          <span className="font-mono text-xs text-muted">{secondsLeft}s</span>
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
  const [loaded, setLoaded] = useState(false);
  // Offset between server clock and local clock; lets the countdown
  // interpolate locally between polls.
  const [clockOffset, setClockOffset] = useState(0);
  const [localNow, setLocalNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    let delay = POLL_MS;
    let timer: ReturnType<typeof setTimeout>;

    const load = async () => {
      try {
        const res = await fetch("/api/live-sessions", { cache: "no-store" });
        if (res.ok) {
          const data: LiveSessionsResponse = await res.json();
          if (cancelled) return;
          setClockOffset(data.serverNow - Date.now());
          setSessions(data.sessions);
          setLoaded(true);
          delay = POLL_MS;
        } else {
          delay = Math.min(delay * 2, POLL_MAX_MS);
        }
      } catch {
        delay = Math.min(delay * 2, POLL_MAX_MS);
      }
      if (!cancelled) timer = setTimeout(load, delay);
    };

    load();
    const tick = setInterval(() => setLocalNow(Date.now()), 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, []);

  const serverNow = localNow + clockOffset;

  return (
    <section id="live" className="mx-auto w-full max-w-6xl px-4 pb-20">
      <div className="grid gap-8 md:grid-cols-3">
        {CATEGORIES.map((cat) => {
          const catSessions = sessions.filter((s) => s.category === cat.key);
          return (
            <div key={cat.key}>
              <h2 className="text-lg font-bold">
                <span className="brand-gradient-text">{cat.title}</span>
              </h2>
              <p className="mb-4 text-sm text-muted">{cat.tagline}</p>
              <div className="flex flex-col gap-4">
                {catSessions.map((s) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    msLeft={((s.legEndsAt - serverNow) % PITCH_LEG_MS + PITCH_LEG_MS) % PITCH_LEG_MS}
                  />
                ))}
                {catSessions.length === 0 && (
                  <div className="rounded-xl border border-dashed border-card-border p-6 text-center text-sm text-muted">
                    {loaded
                      ? "No live sessions right now — start one!"
                      : "Loading live sessions…"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
