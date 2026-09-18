"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Header from "../../../components/Header";
import type {
  OnboardField,
  OnboardResponse,
  OnboardingProfile,
} from "../../../lib/onboarding";
import { MAX_ANSWER_CHARS } from "../../../lib/onboarding";

interface Turn {
  who: "host" | "you";
  text: string;
}

const FIELD_LABELS: Record<OnboardField, string> = {
  displayName: "name",
  seeking: "category",
  lookingFor: "what you want",
  interests: "interests",
  funFact: "fun fact",
};

const FIELD_ORDER: OnboardField[] = [
  "displayName",
  "seeking",
  "lookingFor",
  "interests",
  "funFact",
];

export default function NewSession() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [answers, setAnswers] = useState<Partial<OnboardingProfile>>({});
  const [field, setField] = useState<OnboardField | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [profile, setProfile] = useState<OnboardingProfile | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [hostTalking, setHostTalking] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const step = async (
    current: Partial<OnboardingProfile>,
    answeredField: OnboardField | null,
    message: string,
  ) => {
    setBusy(true);
    setHostTalking(true);
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: current, field: answeredField, message }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data: OnboardResponse = await res.json();
      setAnswers(data.answers);
      setField(data.nextField);
      setSuggestions(data.suggestions ?? []);
      setTurns((t) => [...t, { who: "host", text: data.reply }]);
      if (data.done && data.profile) setProfile(data.profile);
    } catch {
      setTurns((t) => [
        ...t,
        {
          who: "host",
          text: "Sorry — I dropped the connection for a second. Say that again?",
        },
      ]);
    } finally {
      setBusy(false);
      // Brief talking pulse; real lip-synced TTS replaces this.
      setTimeout(() => setHostTalking(false), 900);
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    step({}, null, "");
     
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const send = (text: string) => {
    const msg = text.trim();
    if (!msg || busy || !field) return;
    setTurns((t) => [...t, { who: "you", text: msg }]);
    setInput("");
    step(answers, field, msg);
  };

  const answeredCount = FIELD_ORDER.filter((f) => answers[f] !== undefined).length;

  return (
    <>
      <Header />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8">
        {/* Host tile */}
        <div className="mb-6 flex flex-col items-center">
          <div
            className={`flex h-28 w-28 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-pink to-brand-purple text-5xl shadow-lg shadow-brand-purple/30 transition-transform ${
              hostTalking ? "scale-105" : ""
            }`}
          >
            🎙️
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm text-muted">
            <span className={`h-2 w-2 rounded-full bg-green-400 ${hostTalking ? "live-dot" : ""}`} />
            Your host{hostTalking ? " — speaking…" : ""}
          </div>
          {/* Progress */}
          <div className="mt-4 flex gap-1.5">
            {FIELD_ORDER.map((f) => (
              <div
                key={f}
                title={FIELD_LABELS[f]}
                className={`h-1.5 w-10 rounded-full ${
                  answers[f] !== undefined
                    ? "bg-gradient-to-r from-brand-pink to-brand-purple"
                    : "bg-card-border"
                }`}
              />
            ))}
          </div>
          <div className="mt-1 text-xs text-muted">
            {profile ? "profile complete" : `getting to know you · ${answeredCount}/${FIELD_ORDER.length}`}
          </div>
        </div>

        {/* Transcript */}
        <div
          ref={logRef}
          className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-card-border bg-card/50 p-4"
          style={{ minHeight: "16rem", maxHeight: "24rem" }}
        >
          {turns.map((t, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
                t.who === "host"
                  ? "bg-card text-foreground"
                  : "ml-auto bg-gradient-to-r from-brand-pink/20 to-brand-purple/20 text-foreground"
              }`}
            >
              {t.text}
            </div>
          ))}
          {busy && (
            <div className="max-w-[85%] rounded-xl bg-card px-4 py-2.5 text-sm text-muted">
              …
            </div>
          )}
        </div>

        {/* Completion card or input */}
        {profile ? (
          <div className="mt-4 rounded-xl border border-card-border bg-card p-5">
            <div className="mb-3 text-sm font-semibold">
              Your match profile — <span className="brand-gradient-text">{profile.displayName}</span>
            </div>
            <dl className="grid gap-2 text-sm text-muted sm:grid-cols-2">
              <div>
                <dt className="font-medium text-foreground">Seeking</dt>
                <dd className="capitalize">{profile.seeking}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Looking for</dt>
                <dd>{profile.lookingFor}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Into</dt>
                <dd>{profile.interests.join(", ")}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Fun fact</dt>
                <dd>{profile.funFact}</dd>
              </div>
            </dl>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                disabled
                title="Matchmaking lands next — the bracket seeder is on its way"
                className="cursor-not-allowed rounded-full bg-gradient-to-r from-brand-pink to-brand-purple px-6 py-2.5 font-semibold text-white opacity-60"
              >
                Enter the lobby
              </button>
              <Link href="/" className="text-sm text-muted hover:text-foreground">
                Back home
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            {suggestions.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    onClick={() => send(s)}
                    className="rounded-full border border-card-border bg-card px-4 py-1.5 text-sm transition hover:border-brand-purple"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <button
                type="button"
                disabled
                title="Voice replies land with the realtime build"
                className="cursor-not-allowed rounded-full border border-card-border bg-card px-4 py-2.5 opacity-50"
              >
                🎤
              </button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={MAX_ANSWER_CHARS}
                placeholder={
                  field ? `Your ${FIELD_LABELS[field]}…` : "One moment…"
                }
                disabled={busy || !field}
                className="flex-1 rounded-full border border-card-border bg-card px-4 py-2.5 text-sm outline-none transition focus:border-brand-purple"
              />
              <button
                type="submit"
                disabled={busy || !field || !input.trim()}
                className="rounded-full bg-gradient-to-r from-brand-pink to-brand-purple px-6 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50"
              >
                Send
              </button>
            </form>
          </div>
        )}
      </main>
    </>
  );
}
