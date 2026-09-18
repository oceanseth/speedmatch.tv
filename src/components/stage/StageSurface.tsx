"use client";

import type { RefObject } from "react";
import AvatarGlyph from "../AvatarGlyph";
import { sanitizeAnswer } from "../../lib/onboarding";
import { roundLabel } from "../../lib/types";
import type { RealtimeStatus } from "../../lib/realtime";
import type {
  PersonaCard,
  StageSlot,
  TournamentStateSnapshot,
} from "../../lib/stage";
import { MATCH_PHASES, PHASE_LABELS } from "../../lib/stage";
import type { BroadcastChunkRef } from "../../lib/broadcast";
import BroadcastViewer from "./BroadcastViewer";

interface Props {
  waitingForTournament?: boolean;
  slot: StageSlot | null;
  state: TournamentStateSnapshot | null;
  personas: Record<string, PersonaCard>;
  /** Server-clock "now" (local time + offset), for countdowns. */
  serverNow: number;
  /** This viewer holds the focused stage slot. */
  onStage: boolean;
  /** Camera + realtime session are running. */
  live: boolean;
  status: RealtimeStatus | null;
  caption: string;
  /** Host cue for the running pitch leg — what the host is saying, shown
   * to spectators who don't hear the owner's voice session. */
  pitchLine: string | null;
  /** A LOBBY snapshot is visible to this viewer; server still decides. */
  canStart: boolean;
  startPending: boolean;
  startNotice: string | null;
  onStart: () => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  onGoLive: () => void;
  onLeave: () => void;
  onDecide: (winner: "A" | "B") => void;
  decidePending: boolean;
  mediaError: string | null;
  /** Camera chunks are actively being uploaded for spectators. */
  broadcasting: boolean;
  broadcastNotice: string | null;
  /** Uploaded chunks from this show exist without a confirmed deletion. */
  hasUploadedVideo: boolean;
  deletePending: boolean;
  /** Spectator-facing chunk manifest from the events poll. */
  manifest: BroadcastChunkRef[];
  onBroadcastStart: () => void;
  /** Local stop — uploaded chunks stay for replay per their server TTL. */
  onBroadcastStop: () => void;
  /** Withdraw consent — server deletes this show's uploaded chunks. */
  onDeleteVideo: () => void;
}

function ContestantTile({
  id,
  personas,
  pitching,
}: {
  id: string | null;
  personas: Record<string, PersonaCard>;
  pitching: boolean;
}) {
  const card = id ? personas[id] : undefined;
  const name = id ? (card ? sanitizeAnswer(card.name) : id.slice(0, 8)) : "TBD";
  return (
    <div
      className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 transition ${
        pitching
          ? "border-brand-pink bg-background shadow-md shadow-brand-pink/20"
          : "border-card-border bg-background/60 opacity-70"
      }`}
    >
      <span className="text-xl leading-none">
        {card ? <AvatarGlyph avatar={card.avatar} size={22} /> : "🎭"}
      </span>
      <span className="min-w-0 truncate text-sm font-semibold">{name}</span>
      {pitching && (
        <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-400">
          <span className="live-dot h-1 w-1 rounded-full bg-red-400" />
          Pitching
        </span>
      )}
    </div>
  );
}

export default function StageSurface({
  waitingForTournament = false,
  slot,
  state,
  personas,
  serverNow,
  onStage,
  live,
  status,
  caption,
  pitchLine,
  canStart,
  startPending,
  startNotice,
  onStart,
  videoRef,
  onGoLive,
  onLeave,
  onDecide,
  decidePending,
  mediaError,
  broadcasting,
  broadcastNotice,
  hasUploadedVideo,
  deletePending,
  manifest,
  onBroadcastStart,
  onBroadcastStop,
  onDeleteVideo,
}: Props) {
  const phase = state?.phase ?? slot?.phase ?? null;
  const currentMatch =
    state?.current && phase && MATCH_PHASES.includes(phase)
      ? state.rounds[state.current.round]?.[state.current.index] ?? null
      : null;
  const msLeft =
    state?.deadlineAt != null ? Math.max(0, state.deadlineAt - serverNow) : null;
  const orchestratorBusy = status === "speaking";
  // Deleting uploaded video is a consent action, not a broadcast control:
  // it must stay reachable after the broadcast stops and even after the
  // stage is lost (while broadcasting, "Stop & delete video" covers it).
  const showDeleteVideo = hasUploadedVideo && !broadcasting;

  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-card">
      <div className="relative aspect-video bg-background">
        {/* Main tile: your camera when you're live; the stage-holder's
            broadcast for spectators when they opted in (chunk manifest is
            non-empty); otherwise the seeker placeholder. */}
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className={`h-full w-full object-cover ${onStage && live ? "" : "hidden"}`}
        />
        {!(onStage && live) && manifest.length > 0 && (
          <BroadcastViewer manifest={manifest} />
        )}
        {!(onStage && live) && manifest.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            {slot ? (
              <>
                <span className="flex items-center gap-2 rounded-full bg-red-500/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-red-400">
                  <span className="live-dot h-1.5 w-1.5 rounded-full bg-red-400" />
                  On stage
                </span>
                <div className="text-2xl font-bold">
                  {sanitizeAnswer(slot.seeker)}
                </div>
                <p className="max-w-sm px-4 text-sm text-muted">
                  {onStage
                    ? "This is your stage. Go live to start your camera and talk to the host — broadcasting to viewers stays off until you turn it on."
                    : "Talking to the host over voice — follow along in chat and the bracket."}
                </p>
              </>
            ) : (
              <>
                <div className="text-3xl">🎬</div>
                <div className="text-lg font-semibold">{waitingForTournament ? "Tournament lobby" : "The stage is open"}</div>
                <p className="max-w-sm px-4 text-sm text-muted">
                  {waitingForTournament
                    ? "Your tournament is selected. Waiting for the host and live tournament updates."
                    : "Apply from the queue panel and the host will call you up."}
                </p>
              </>
            )}
          </div>
        )}

        {/* Live voice captions win; otherwise the pitch cue fills the same
            bar so spectators read what the host is saying. */}
        {(caption || pitchLine) && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8 text-center text-sm font-medium text-white">
            {caption || pitchLine}
          </div>
        )}

        {(onStage || showDeleteVideo) && (
          <div className="absolute right-3 top-3 flex flex-wrap justify-end gap-2">
            {onStage &&
              (!live ? (
                <button
                  type="button"
                  onClick={onGoLive}
                  className="rounded-full bg-gradient-to-r from-brand-pink to-brand-purple px-4 py-1.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
                >
                  Go live — camera & mic
                </button>
              ) : (
                <>
                  {!broadcasting ? (
                    <button
                      type="button"
                      onClick={onBroadcastStart}
                      className="rounded-full bg-gradient-to-r from-brand-pink to-brand-purple px-4 py-1.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
                    >
                      Broadcast camera to viewers
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={onBroadcastStop}
                        className="rounded-full border border-card-border bg-card/80 px-4 py-1.5 text-sm font-medium backdrop-blur transition hover:border-red-400"
                      >
                        Stop broadcast
                      </button>
                      <button
                        type="button"
                        onClick={onDeleteVideo}
                        disabled={deletePending}
                        className="rounded-full border border-card-border bg-card/80 px-4 py-1.5 text-sm font-medium backdrop-blur transition hover:border-red-400 disabled:opacity-50"
                        title="Stop broadcasting and delete the video uploaded so far"
                      >
                        Stop & delete video
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={onLeave}
                    className="rounded-full border border-card-border bg-card/80 px-4 py-1.5 text-sm font-medium backdrop-blur transition hover:border-red-400"
                  >
                    Leave stage
                  </button>
                </>
              ))}
            {showDeleteVideo && (
              <button
                type="button"
                onClick={onDeleteVideo}
                disabled={deletePending}
                className="rounded-full border border-red-400/60 bg-card/80 px-4 py-1.5 text-sm font-medium text-red-400 backdrop-blur transition hover:bg-red-500/10 disabled:opacity-50"
              >
                {deletePending ? "Deleting…" : "Delete my video from this show"}
              </button>
            )}
          </div>
        )}
        {/* Honest broadcast state whenever the camera is on: either an
            explicit local-only note or a hard-to-miss REC indicator. */}
        {onStage && live && (
          broadcasting ? (
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-red-500/85 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-white" />
              Rec — viewers can see you
            </div>
          ) : (
            <div className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur">
              Local preview — viewers can’t see your camera
            </div>
          )
        )}
        {(mediaError ?? broadcastNotice) && (
          <div className="absolute inset-x-0 top-0 bg-red-500/80 px-4 py-1.5 text-center text-xs font-medium text-white">
            {mediaError ?? broadcastNotice}
          </div>
        )}
      </div>

      {/* Cast rail: orchestrator + the two contestants of the live match. */}
      <div className="flex items-stretch gap-2 border-t border-card-border/60 px-3 py-2">
        <div className="flex items-center gap-2 rounded-lg border border-card-border bg-background/60 px-3 py-2">
          <span className={`text-xl leading-none ${orchestratorBusy ? "live-dot" : ""}`}>
            🎙️
          </span>
          <div className="text-xs">
            <div className="font-semibold">Host</div>
            <div className="text-muted">
              {status === null || status === "closed"
                ? "off air"
                : status === "speaking"
                  ? "speaking"
                  : status === "listening"
                    ? "listening"
                    : status}
            </div>
          </div>
        </div>
        {currentMatch ? (
          <>
            <ContestantTile
              id={currentMatch.entrantA}
              personas={personas}
              pitching={phase === "PITCH_A"}
            />
            <ContestantTile
              id={currentMatch.entrantB}
              personas={personas}
              pitching={phase === "PITCH_B"}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-xs text-muted">
            {phase ? PHASE_LABELS[phase] : "Waiting for a session…"}
          </div>
        )}
      </div>

      {/* Phase banner: label, round, countdown. */}
      {phase && (
        <div className="flex items-center gap-3 border-t border-card-border/60 px-4 py-2 text-xs text-muted">
          <span className="font-bold uppercase tracking-widest">
            {PHASE_LABELS[phase]}
          </span>
          {state?.current && state.rounds.length > 0 && (
            <span>{roundLabel(state.current.round, state.rounds.length)}</span>
          )}
          {msLeft !== null && (
            <span className="ml-auto flex items-center gap-2">
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-background">
                {/* deadline windows vary per phase; 30s is a display-only
                    normalization so the bar always moves */}
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-brand-pink to-brand-purple"
                  style={{ width: `${Math.min(100, (msLeft / 30_000) * 100)}%` }}
                />
              </span>
              <span className="font-mono">{Math.ceil(msLeft / 1000)}s</span>
            </span>
          )}
        </div>
      )}

      {/* Start the show from LOBBY. The server enforces owner + completed
          profile; the notice below relays its verdict. */}
      {canStart && (
        <div className="border-t border-card-border/60 p-3">
          <button
            type="button"
            disabled={startPending}
            onClick={onStart}
            className="w-full rounded-full bg-gradient-to-r from-brand-pink to-brand-purple px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 disabled:opacity-50"
          >
            {startPending ? "Starting…" : "Start the show"}
          </button>
          {startNotice && (
            <p className="mt-2 text-center text-xs text-red-400">{startNotice}</p>
          )}
        </div>
      )}

      {/* Voice is primary for the decision; buttons are the fallback. The
          server enforces owner-only USER_DECISION — hiding these from
          spectators is presentation, not security. */}
      {onStage && phase === "DECIDE" && currentMatch && (
        <div className="flex gap-2 border-t border-card-border/60 p-3">
          {(["A", "B"] as const).map((side) => {
            const id = side === "A" ? currentMatch.entrantA : currentMatch.entrantB;
            const card = id ? personas[id] : undefined;
            return (
              <button
                key={side}
                type="button"
                disabled={decidePending}
                onClick={() => onDecide(side)}
                className="flex-1 rounded-full border border-brand-purple/60 bg-background px-4 py-2 text-sm font-semibold transition hover:border-brand-pink hover:bg-card disabled:opacity-40"
              >
                Advance {card ? sanitizeAnswer(card.name) : side}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
