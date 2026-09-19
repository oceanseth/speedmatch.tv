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
  postStart,
  type PersonaCard,
  type SessionEvent,
  type StageSnapshot,
  type TournamentStateSnapshot,
} from "../../lib/stage";
import { RealtimeVoiceSession, type RealtimeStatus } from "../../lib/realtime";
import {
  BroadcastRecorder,
  foldManifest,
  forgetBroadcastUpload,
  hasBroadcastUpload,
  httpBroadcastTransport,
  rememberBroadcastUpload,
  type BroadcastChunkRef,
} from "../../lib/broadcast";
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
  const [pitchCue, setPitchCue] = useState<
    { side: "A" | "B"; personaId: string; line: string } | null
  >(null);
  const pitchLine = pitchCue?.line ?? null;
  /** Autoplay was refused before any user gesture — show the enable button. */
  const [voicesBlocked, setVoicesBlocked] = useState(false);
  const pitchAudioRef = useRef<HTMLAudioElement | null>(null);
  const pitchAudioUrlRef = useRef<string | null>(null);
  const lastPitchLegRef = useRef<string | null>(null);
  const [startPending, setStartPending] = useState(false);
  const [startNotice, setStartNotice] = useState<string | null>(null);
  /** Set by the events-poll effect; lets chat/decide refresh immediately. */
  const pollNowRef = useRef<() => void>(() => {});

  const [tab, setTab] = useState<"chat" | "bracket">("chat");

  const [live, setLive] = useState(false);
  const [rtStatus, setRtStatus] = useState<RealtimeStatus | null>(null);
  const [caption, setCaption] = useState("");
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [decidePending, setDecidePending] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastNotice, setBroadcastNotice] = useState<string | null>(null);
  /** Chunks from this show exist on the server without a confirmed
   * deletion — keeps the "delete my video" consent action reachable
   * after the broadcast (and even the stage) are gone. */
  const [uploadedVideo, setUploadedVideo] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [manifest, setManifest] = useState<BroadcastChunkRef[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const rtSessionRef = useRef<RealtimeVoiceSession | null>(null);
  const broadcastRef = useRef<BroadcastRecorder | null>(null);
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
    setPitchCue(null);
    setStartNotice(null);
    setManifest([]);
    setUploadedVideo(false);
    setDeletePending(false);
  }

  const stopPitchAudio = useCallback(() => {
    pitchAudioRef.current?.pause();
    if (pitchAudioUrlRef.current) {
      URL.revokeObjectURL(pitchAudioUrlRef.current);
      pitchAudioUrlRef.current = null;
    }
  }, []);

  // Voice: each new pitch leg fetches its synthesized 15-second clip and
  // plays it. The leg key (not the cue object) gates replays, so the 2s
  // poll re-delivering the same cue never restarts audio. Autoplay refusal
  // (spectator with no gesture yet) surfaces the enable button; the clip
  // stays loaded so the button can start it mid-leg.
  useEffect(() => {
    const id = focusedTournamentId;
    const phase = tState?.phase;
    const cur = tState?.current;
    if (
      !id ||
      !pitchCue ||
      !cur ||
      (phase !== "PITCH_A" && phase !== "PITCH_B")
    )
      return;
    const leg = `${cur.round}-${cur.index}-${pitchCue.side}`;
    if (lastPitchLegRef.current === leg) return;
    lastPitchLegRef.current = leg;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/tournaments/${id}/pitch-audio?leg=${leg}`,
        );
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        if (cancelled) return;
        stopPitchAudio();
        const url = URL.createObjectURL(blob);
        pitchAudioUrlRef.current = url;
        const el = pitchAudioRef.current ?? new Audio();
        pitchAudioRef.current = el;
        el.src = url;
        try {
          await el.play();
          setVoicesBlocked(false);
        } catch {
          setVoicesBlocked(true);
        }
      } catch {
        // Synthesis unavailable: the caption still carries the pitch.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focusedTournamentId, pitchCue, tState, stopPitchAudio]);

  // New focus (or unmount): silence any clip from the previous show.
  useEffect(
    () => () => {
      lastPitchLegRef.current = null;
      stopPitchAudio();
    },
    [focusedTournamentId, stopPitchAudio],
  );

  const enablePitchVoices = () => {
    setVoicesBlocked(false);
    void pitchAudioRef.current?.play().catch(() => setVoicesBlocked(true));
  };

  // Load upload memory per focused tournament; deferred (like the stored
  // name) so hydration completes before localStorage-driven UI lands.
  useEffect(() => {
    if (!focusedTournamentId) return;
    const id = focusedTournamentId;
    const t = setTimeout(() => setUploadedVideo(hasBroadcastUpload(id)), 0);
    return () => clearTimeout(t);
  }, [focusedTournamentId]);

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
      setPitchCue(res.data.pitch ?? null);
      if (res.data.personas) {
        setPersonas((prev) => ({ ...prev, ...res.data.personas }));
      }
      if (res.data.events.length > 0) {
        lastSeq = Math.max(lastSeq, ...res.data.events.map((e) => e.seq));
        setEvents((prev) =>
          [...prev, ...res.data.events].slice(-MAX_EVENTS_KEPT),
        );
        setManifest((prev) => foldManifest(prev, res.data.events));
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

  /** Local stop: uploaded chunks stay for replay per their server TTL.
   * Deleting them is a separate consent action (deleteVideo), reachable
   * whether or not a broadcast is running. */
  const stopBroadcast = useCallback(() => {
    const rec = broadcastRef.current;
    broadcastRef.current = null;
    setBroadcasting(false);
    rec?.stop();
  }, []);

  /** Withdraw consent: stop any live broadcast and have the server delete
   * the uploaded chunks. Revoke is a plain POST, not a recorder method, so
   * this works after stopping, after losing the stage, and after reloads —
   * the upload memory clears only on server-confirmed deletion. */
  const deleteVideo = useCallback(async (tournamentId: string) => {
    setDeletePending(true);
    const rec = broadcastRef.current;
    broadcastRef.current = null;
    setBroadcasting(false);
    const ok = rec
      ? await rec.revoke()
      : await httpBroadcastTransport().revoke(tournamentId);
    if (ok) {
      forgetBroadcastUpload(tournamentId);
      setUploadedVideo(false);
      setBroadcastNotice(null);
    } else {
      setBroadcastNotice("Couldn’t delete your video — try again.");
    }
    setDeletePending(false);
  }, []);

  const stopMedia = useCallback(() => {
    stopBroadcast();
    rtSessionRef.current?.close();
    rtSessionRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(false);
    setRtStatus(null);
    setCaption("");
  }, [stopBroadcast]);

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

  // Opt-in per stage-take: never started implicitly, and the recorder
  // stops itself the moment a per-chunk mint is refused (stage lost).
  const startBroadcast = () => {
    if (!focusedTournamentId || !mediaStreamRef.current || broadcastRef.current)
      return;
    const id = focusedTournamentId;
    setBroadcastNotice(null);
    const recorder = new BroadcastRecorder(
      id,
      mediaStreamRef.current,
      httpBroadcastTransport(),
      {
        onChunkUploaded: () => {
          rememberBroadcastUpload(id);
          setUploadedVideo(true);
        },
        onStatus: (status, reason) => {
          if (status === "broadcasting") {
            setBroadcasting(true);
            return;
          }
          setBroadcasting(false);
          if (broadcastRef.current === recorder) broadcastRef.current = null;
          if (reason === "denied") {
            setBroadcastNotice("Broadcast stopped — this stage is no longer yours.");
          } else if (reason === "upload-failed") {
            setBroadcastNotice("Broadcast stopped — uploads kept failing.");
          } else if (reason === "recorder-failed") {
            setBroadcastNotice("Broadcast stopped — camera recording failed.");
          }
        },
      },
    );
    broadcastRef.current = recorder;
    recorder.start();
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

  /** The server enforces owner+profile; this reports its verdict honestly
   * instead of guessing client-side. `already_started` means another tab
   * (or a voice command) won the race — a refresh, not an error. */
  const startShow = async () => {
    if (!focusedTournamentId || startPending) return;
    setStartPending(true);
    setStartNotice(null);
    const res = await postStart(focusedTournamentId);
    if (res.ok || res.error === "already_started") {
      pollNowRef.current();
    } else if (res.status === 401) {
      setStartNotice("Sign in to start your show.");
    } else if (res.error === "no_profile") {
      setStartNotice(
        "Finish the voice interview at /session/new first — the host needs your profile.",
      );
    } else if (res.status === 404) {
      setStartNotice("Only the show’s owner can start it.");
    } else {
      setStartNotice("Couldn’t start the show — try again.");
    }
    setStartPending(false);
  };

  const decide = async (winner: "A" | "B") => {
    if (!focusedTournamentId || decidePending) return;
    setDecidePending(true);
    await postDecision(focusedTournamentId, winner);
    pollNowRef.current();
    setDecidePending(false);
  };

  // Start shows for whoever can already see a LOBBY snapshot (owner via
  // ?tournament= link, or the stage-holder heuristic) — presentation
  // only; a non-owner's click gets the server's 404 verdict.
  const canStart =
    tState?.phase === "LOBBY" && (onStage || tournamentId != null);

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
          {voicesBlocked && (
            <button
              type="button"
              onClick={enablePitchVoices}
              className="self-start rounded-full bg-gradient-to-r from-brand-pink to-brand-purple px-4 py-1.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
            >
              🔊 Tap to hear the pitches
            </button>
          )}
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
            pitchLine={pitchLine}
            canStart={canStart}
            startPending={startPending}
            startNotice={startNotice}
            onStart={() => void startShow()}
            videoRef={videoRef}
            onGoLive={() => void goLive()}
            onLeave={stopMedia}
            onDecide={(w) => void decide(w)}
            decidePending={decidePending}
            mediaError={mediaError}
            broadcasting={broadcasting}
            broadcastNotice={broadcastNotice}
            hasUploadedVideo={uploadedVideo}
            deletePending={deletePending}
            manifest={manifest}
            onBroadcastStart={startBroadcast}
            onBroadcastStop={stopBroadcast}
            onDeleteVideo={() => {
              if (focusedTournamentId && !deletePending)
                void deleteVideo(focusedTournamentId);
            }}
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
