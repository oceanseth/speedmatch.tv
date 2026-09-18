"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Header from "../../../components/Header";
import OnboardingVoice from "../../../components/OnboardingVoice";
import type {
  OnboardField,
  OnboardResponse,
  OnboardingProfile,
} from "../../../lib/onboarding";
import type { OnboardingCue } from "../../../lib/onboardingVoice";
import { enterPublicLobby } from "../../../lib/onboardingLobby";
import { MAX_ANSWER_CHARS } from "../../../lib/onboarding";

interface Turn {
  id?: string;
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
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [answers, setAnswers] = useState<Partial<OnboardingProfile>>({});
  const [field, setField] = useState<OnboardField | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [profile, setProfile] = useState<OnboardingProfile | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(true);
  const [cue, setCue] = useState<OnboardingCue | null>(null);
  const [saved, setSaved] = useState<OnboardResponse["saved"]>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [entering, setEntering] = useState(false);
  const [lobbyError, setLobbyError] = useState("");
  const [needsSignin, setNeedsSignin] = useState(false);
  const enteringRef = useRef(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  // Refs are updated before rendering so back-to-back final captions cannot
  // submit stale answers. Typed input and voice share this serialized pipeline.
  const machine = useRef<{ answers: Partial<OnboardingProfile>; field: OnboardField | null; done: boolean }>({ answers: {}, field: null, done: false });
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const lifecycle = useRef<AbortController | null>(null);

  const apply = useCallback((data: OnboardResponse) => {
    const id = crypto.randomUUID();
    machine.current = { answers: data.answers, field: data.nextField, done: data.done };
    setAnswers(data.answers);
    setField(data.nextField);
    setSuggestions(data.suggestions ?? []);
    setCue({ id, reply: data.reply, nextField: data.nextField });
    setTurns(t => [...t, { id, who: "host" as const, text: data.reply }].slice(-100));
    if (data.done && data.profile) {
      setProfile(data.profile);
      setSaved(data.saved);
    }
  }, []);

  const step = useCallback(async (
    current: Partial<OnboardingProfile>,
    answeredField: OnboardField | null,
    message: string,
    signal: AbortSignal,
  ) => {
    const res = await fetch("/api/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: current, field: answeredField, message }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (!res.ok) throw new Error(String(res.status));
    const data: OnboardResponse = await res.json();
    if (!signal.aborted) apply(data);
    return data;
  }, [apply]);

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    const { signal } = controller;
    void (async () => {
      try {
        const res = await fetch("/api/onboard", {
          cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data: { profile: OnboardingProfile | null } = await res.json();
        if (signal.aborted) return;
        if (data.profile) {
          apply({
            answers: data.profile, profile: data.profile, nextField: null, done: true, saved: "saved",
            reply: `Welcome back, ${data.profile.displayName}! Your match profile is saved. Ready to open the bracket?`,
          });
        } else {
          await step({}, null, "", signal);
        }
      } catch {
        // A failed lookup must not masquerade as a new guest and re-interview them.
        if (!signal.aborted) setLoadError(true);
      } finally {
        if (!signal.aborted) setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [apply, step, loadAttempt]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const submitAnswer = (text: string) => {
    const msg = text.trim().slice(0, 2000);
    const signal = lifecycle.current?.signal;
    if (!msg || !signal || signal.aborted || machine.current.done || !machine.current.field) return;
    setTurns(t => [...t, { who: "you" as const, text: msg }].slice(-100));
    setBusy(true);
    pending.current++;
    queue.current = queue.current.then(async () => {
      if (signal.aborted || machine.current.done) return;
      try {
        await step(machine.current.answers, machine.current.field, msg, signal);
      } catch {
        if (signal.aborted) return;
        const reply = "Sorry — I couldn’t save that answer. Please say it again.";
        const id = crypto.randomUUID();
        setTurns(t => [...t, { id, who: "host" as const, text: reply }].slice(-100));
        setCue({ id, reply, nextField: machine.current.field });
      }
    }).finally(() => {
      pending.current--;
      if (!signal.aborted && pending.current === 0) setBusy(false);
    });
  };

  const send = (text: string) => {
    if (busy || voiceActive) return;
    submitAnswer(text);
    setInput("");
  };

  const retrySave = async () => {
    const signal = lifecycle.current?.signal;
    if (busy || !profile || !signal || signal.aborted) return;
    setBusy(true);
    try { await step(machine.current.answers, null, "", signal); }
    catch { if (!signal.aborted) setSaved("failed"); }
    finally { if (!signal.aborted) setBusy(false); }
  };

  const answeredCount = FIELD_ORDER.filter((f) => answers[f] !== undefined).length;

  const enterLobby = async () => {
    const signal = lifecycle.current?.signal;
    if (busy || enteringRef.current || !profile || !signal || signal.aborted) return;
    enteringRef.current = true;
    setEntering(true); setLobbyError(""); setNeedsSignin(false);
    try {
      // A guest may have signed in in another tab. Attach these answers before
      // creating the tournament; never discard an unsaved completed interview.
      if (saved !== "saved") {
        const completion = await step(machine.current.answers, null, "", signal);
        if (completion.saved === "failed") throw new Error("save failed");
      }
      if (signal.aborted) return;
      const result = await enterPublicLobby(profile.seeking);
      if (signal.aborted) return;
      if (result.status === "ready") router.push(result.href);
      else if (result.status === "signin") {
        setNeedsSignin(true);
        setLobbyError("Sign in in a new tab, then try entering the lobby again. Your answers will stay here.");
      } else setLobbyError("We couldn’t open your tournament. Please try again.");
    } catch {
      if (!signal.aborted) setLobbyError("We couldn’t save your profile. Retry saving before entering the lobby.");
    } finally {
      enteringRef.current = false;
      if (!signal.aborted) setEntering(false);
    }
  };

  return (
    <>
      <Header />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8">
        <OnboardingVoice cue={cue} onAnswer={submitAnswer} onActive={setVoiceActive} onTurn={(id, who, text) => {
          setTurns(previous => {
            const index = previous.findIndex(turn => turn.id === id);
            if (index < 0) return [...previous, { id, who, text }].slice(-100);
            return previous.map((turn, i) => i === index ? { id, who, text } : turn);
          });
        }} />
        <div className="mb-6 flex flex-col items-center">
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
            {profile ? "profile complete · 5/5" : `getting to know you · ${answeredCount}/${FIELD_ORDER.length}`}
          </div>
        </div>

        {loadError && <div role="alert" className="mb-4 text-sm text-brand-pink">
          We couldn’t load your saved profile. Retry before starting the interview.
          <button type="button" onClick={() => { setLoadError(false); setBusy(true); setLoadAttempt(n => n + 1); }} className="ml-2 underline">Retry</button>
        </div>}

        {/* Transcript */}
        <div
          ref={logRef}
          className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-card-border bg-card/50 p-4"
          style={{ minHeight: "16rem", maxHeight: "24rem" }}
        >
          {turns.map((t, i) => (
            <div
              key={t.id ?? i}
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
            {saved === "saved" && <p role="status" className="mt-4 text-sm text-muted">Saved to your account.</p>}
            {saved === "failed" && <p role="alert" className="mt-4 text-sm text-brand-pink">
              Your answers are complete, but saving failed. Keep this page open and
              <button type="button" disabled={busy || entering} onClick={() => void retrySave()} className="ml-1 underline disabled:opacity-50">Retry saving</button>.
            </p>}
            {saved === "anonymous" && <p role="status" className="mt-4 text-sm text-brand-pink">
              This profile isn’t saved to your account. <Link href="/login" target="_blank" rel="noopener noreferrer" className="underline">Sign in to keep this</Link> (opens a new tab), then enter the lobby to save your answers.
            </p>}
            {lobbyError && <p role="alert" className="mt-4 text-sm text-brand-pink">
              {lobbyError} {needsSignin && <Link href="/login" target="_blank" rel="noopener noreferrer" className="underline">Sign in (new tab)</Link>}
            </p>}
            <p className="mt-4 text-sm text-muted">Entering the public lobby makes your tournament visible to spectators. Your raw interview stays private.</p>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                disabled={busy || entering || saved === "failed"}
                onClick={() => void enterLobby()}
                className="rounded-full bg-gradient-to-r from-brand-pink to-brand-purple px-6 py-2.5 font-semibold text-white disabled:opacity-60"
              >
                {entering ? "Opening lobby…" : "Enter public lobby"}
              </button>
              <Link href="/" className="text-sm text-muted hover:text-foreground">
                Back home
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            {voiceActive && <p className="mb-3 text-sm text-muted">Voice answers fill in your profile above. Stop the microphone to switch to typing.</p>}
            {suggestions.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy || voiceActive}
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
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={MAX_ANSWER_CHARS}
                placeholder={
                  field ? `Your ${FIELD_LABELS[field]}…` : "One moment…"
                }
                disabled={busy || voiceActive || !field}
                className="flex-1 rounded-full border border-card-border bg-card px-4 py-2.5 text-sm outline-none transition focus:border-brand-purple"
              />
              <button
                type="submit"
                disabled={busy || voiceActive || !field || !input.trim()}
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
