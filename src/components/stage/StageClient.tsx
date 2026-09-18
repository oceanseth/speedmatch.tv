"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Category } from "../../lib/types";
import { sanitizeAnswer } from "../../lib/onboarding";
import {
  applyForStage,
  fetchEvents,
  fetchStage,
  postChat,
  postDecision,
  type PersonaCard,
  type SessionEvent,
  type StageSnapshot,
  type TournamentStateSnapshot,
} from "../../lib/stage";
import { RealtimeVoiceSession, type RealtimeStatus } from "../../lib/realtime";
import StageSurface from "./StageSurface";
import QueueRail from "./QueueRail";
import ChatPanel, { type ChatMessage } from "./ChatPanel";
import BracketPanel from "./BracketPanel";

const STAGE_POLL_MS = 4_000;
const STAGE_POLL_MAX_MS = 30_000;
const EVENTS_POLL_MS = 2_000;
const NAME_STORAGE_KEY = "sm-stage-name";
const MAX_EVENTS_KEPT = 200;

/** session_events types rendered as system lines in chat. Unknown types
 * (TOKEN_MINTED, raw transitions we don't label) are simply skipped. */
const SYSTEM_EVENT_LINES: Record<string, string> = {
  START_ONBOARD: "Onboarding started",
  ONBOARD_COMPLETE: "Onboarding complete",
  SEEDED: "Bracket seeded",
  USER_DECISION: "Winner picked — advancing",
  FINAL: "Tournament complete",
  ABANDONED: "Session ended",
};

function toChatMessages(events: SessionEvent[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const evt of events) {
    if (evt.type === "CHAT") {
      const name = evt.payload.displayName;
      const text = evt.payload.text;
      if (typeof name === "string" && typeof text === "string") {
        out.push({ key: `c${evt.seq}`, displayName: name, text });
      }
    } else if (SYSTEM_EVENT_LINES[evt.type]) {
      out.push({
        key: `s${evt.seq}`,
        displayName: "",
        text: SYSTEM_EVENT_LINES[evt.type],
        system: true,
      });
    }
  }
  return out;
}

export default function StageClient({ category, tournamentId = null }: { category: Category; tournamentId?: string | null }) {
  const [snapshot, setSnapshot] = useState<StageSnapshot | null>(null);
  const [offline, setOffline] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const [localNow, setLocalNow] = useState(() => Date.now());
  const [focus, setFocus] = useState<"main" | "side">("main");

  const [myName, setMyName] = useState("");
  const [appliedPosition, setAppliedPosition] = useState<number | null>(null);

  const [tState, setTState] = useState<TournamentStateSnapshot | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [personas, setPersonas] = useState<Record<string, PersonaCard>>({});
  /** Set by the events-poll effect; lets chat/decide refresh immediately. */
  const pollNowRef = useRef<() => void>(() => {});

  const [tab, setTab] = useState<"chat" | "bracket">("chat");

  const [live, setLive] = useState(false);
  const [rtStatus, setRtStatus] = useState<RealtimeStatus | null>(null);
  const [caption, setCaption] = useState("");
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [decidePending, setDecidePending] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const rtSessionRef = useRef<RealtimeVoiceSession | null>(null);
  const captionClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(NAME_STORAGE_KEY);
    if (!stored) return;
    // Deferred so hydration completes against the server-rendered empty
    // value before the stored name lands.
    const t = setTimeout(() => setMyName(stored), 0);
    return () => clearTimeout(t);
  }, []);

  // Stage snapshot poll with backoff, same pattern as LiveShowcase.
  useEffect(() => {
    let cancelled = false;
    let delay = STAGE_POLL_MS;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const res = await fetchStage(category);
      if (cancelled) return;
      if (res.ok) {
        setSnapshot(res.data);
        setClockOffset(res.data.serverNow - Date.now());
        setOffline(false);
        delay = STAGE_POLL_MS;
      } else {
        setOffline(true);
        delay = Math.min(delay * 2, STAGE_POLL_MAX_MS);
      }
      timer = setTimeout(load, delay);
    };
    void load();
    const tick = setInterval(() => setLocalNow(Date.now()), 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [category]);

  const focusedSlot = tournamentId
    ? [snapshot?.main, snapshot?.side].find(slot => slot?.tournamentId === tournamentId) ?? null
    : (focus === "side" ? snapshot?.side : snapshot?.main) ?? null;
  const focusedTournamentId = tournamentId ?? focusedSlot?.tournamentId ?? null;

  // Reset per-tournament state the moment focus switches — the
  // adjust-state-during-render pattern, so no effect-driven cascade.
  const [eventsFor, setEventsFor] = useState<string | null>(null);
  if (eventsFor !== focusedTournamentId) {
    setEventsFor(focusedTournamentId);
    setTState(null);
    setEvents([]);
    setPersonas({});
  }

  // Events poll follows the focused tournament; the seq cursor lives in
  // the effect so a focus switch starts clean.
  useEffect(() => {
    if (!focusedTournamentId) return;
    const id = focusedTournamentId;
    let lastSeq = 0;
    let cancelled = false;
    const poll = async () => {
      const res = await fetchEvents(id, lastSeq);
      if (cancelled || !res.ok) return;
      setTState(res.data.state);
      if (res.data.personas) {
        setPersonas((prev) => ({ ...prev, ...res.data.personas }));
      }
      if (res.data.events.length > 0) {
        lastSeq = Math.max(lastSeq, ...res.data.events.map((e) => e.seq));
        setEvents((prev) =>
          [...prev, ...res.data.events].slice(-MAX_EVENTS_KEPT),
        );
      }
    };
    pollNowRef.current = () => void poll();
    void poll();
    const timer = setInterval(() => void poll(), EVENTS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      pollNowRef.current = () => {};
    };
  }, [focusedTournamentId]);

  // Pre-auth heuristic for "this is my stage": the seeker pseudonym I
  // applied with matches the main slot. The backend enforces real
  // ownership on every privileged call (token mint, decision); this only
  // decides which UI to show. Replaced when minimal auth lands.
  const onStage =
    (!tournamentId || snapshot?.main?.tournamentId === tournamentId) &&
    focus === "main" &&
    snapshot?.main != null &&
    myName.trim() !== "" &&
    snapshot.main.seeker === sanitizeAnswer(myName, { maxChars: 60 });

  const stopMedia = useCallback(() => {
    rtSessionRef.current?.close();
    rtSessionRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(false);
    setRtStatus(null);
    setCaption("");
  }, []);

  useEffect(() => stopMedia, [stopMedia]);
  // Losing the stage (slot handed to someone else) ends the session;
  // deferred a tick since teardown flips React state too.
  useEffect(() => {
    if (!live || onStage) return;
    const t = setTimeout(stopMedia, 0);
    return () => clearTimeout(t);
  }, [live, onStage, stopMedia]);

  const goLive = async () => {
    if (!focusedTournamentId) return;
    setMediaError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      mediaStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setLive(true);
      const session = new RealtimeVoiceSession({
        onStatus: setRtStatus,
        onCaption: (delta, done) => {
          if (captionClearRef.current) clearTimeout(captionClearRef.current);
          if (done) {
            captionClearRef.current = setTimeout(() => setCaption(""), 4_000);
          } else {
            setCaption((prev) => (prev + delta).slice(-200));
          }
        },
        onError: (msg) => setMediaError(msg),
      });
      rtSessionRef.current = session;
      await session.connect(focusedTournamentId, stream);
    } catch (err) {
      stopMedia();
      setMediaError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Camera/mic permission denied — allow access to go live."
          : "Couldn’t start the live session. Check the backend and try again.",
      );
    }
  };

  const apply = async () => {
    const name = sanitizeAnswer(myName, { maxChars: 60 });
    if (!name) return false;
    localStorage.setItem(NAME_STORAGE_KEY, name);
    setMyName(name);
    const res = await applyForStage(category, name);
    if (res.ok) setAppliedPosition(res.data.position);
    return res.ok;
  };

  const sendChat = async (text: string) => {
    if (!focusedTournamentId) return false;
    const res = await postChat(focusedTournamentId, text);
    if (res.ok) pollNowRef.current();
    return res.ok;
  };

  const decide = async (winner: "A" | "B") => {
    if (!focusedTournamentId || decidePending) return;
    setDecidePending(true);
    await postDecision(focusedTournamentId, winner);
    pollNowRef.current();
    setDecidePending(false);
  };

  const serverNow = localNow + clockOffset;
  const chatDisabledReason = tournamentId && !tState
    ? "Chat opens when live tournament updates are available."
    : !focusedTournamentId
    ? offline
      ? "Stage backend isn’t reachable yet."
      : "Chat opens when a session takes this stage."
    : null;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <div className={`grid gap-4 ${tournamentId ? "" : "lg:grid-cols-[minmax(0,1fr)_300px]"}`}>
        <div className="flex min-w-0 flex-col gap-4">
          <StageSurface
            waitingForTournament={!!tournamentId}
            slot={focusedSlot}
            state={tState}
            personas={personas}
            serverNow={serverNow}
            onStage={onStage}
            live={live}
            status={rtStatus}
            caption={caption}
            videoRef={videoRef}
            onGoLive={() => void goLive()}
            onLeave={stopMedia}
            onDecide={(w) => void decide(w)}
            decidePending={decidePending}
            mediaError={mediaError}
          />

          {/* Chat <-> live bracket toggle under the video surface. */}
          <div className="flex h-80 flex-col overflow-hidden rounded-xl border border-card-border bg-card">
            <div className="flex border-b border-card-border/60">
              {(["chat", "bracket"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`px-5 py-2.5 text-sm font-semibold capitalize transition ${
                    tab === t
                      ? "border-b-2 border-brand-pink text-foreground"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {t === "chat" ? "Stage chat" : "Bracket"}
                </button>
              ))}
              <span className="ml-auto self-center pr-4 text-xs text-muted">
                {focusedSlot
                  ? `Watching ${sanitizeAnswer(focusedSlot.seeker)}`
                  : tournamentId ? "Tournament selected" : "Stage idle"}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              {tab === "chat" ? (
                <ChatPanel
                  messages={toChatMessages(events)}
                  onSend={sendChat}
                  disabledReason={chatDisabledReason}
                />
              ) : (
                <BracketPanel state={tState} personas={personas} />
              )}
            </div>
          </div>
        </div>

        {!tournamentId && <QueueRail
          side={snapshot?.side ?? null}
          queue={snapshot?.queue ?? []}
          myName={myName}
          onNameChange={setMyName}
          appliedPosition={appliedPosition}
          onApply={apply}
          offline={offline}
          sideFocused={focus === "side"}
          onToggleFocus={() => setFocus(focus === "side" ? "main" : "side")}
        />}
      </div>
    </main>
  );
}
