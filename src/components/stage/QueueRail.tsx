"use client";

import { useState } from "react";
import { sanitizeAnswer } from "../../lib/onboarding";
import type { QueueEntry, StageSlot } from "../../lib/stage";
import { PHASE_LABELS } from "../../lib/stage";

interface Props {
  side: StageSlot | null;
  queue: QueueEntry[];
  myName: string;
  onNameChange: (name: string) => void;
  appliedPosition: number | null;
  onApply: () => Promise<boolean>;
  offline: boolean;
  sideFocused: boolean;
  onToggleFocus: () => void;
}

export default function QueueRail({
  side,
  queue,
  myName,
  onNameChange,
  appliedPosition,
  onApply,
  offline,
  sideFocused,
  onToggleFocus,
}: Props) {
  const [applying, setApplying] = useState(false);
  const [failed, setFailed] = useState(false);

  const apply = async () => {
    if (applying || !myName.trim()) return;
    setApplying(true);
    setFailed(false);
    const ok = await onApply();
    setApplying(false);
    if (!ok) setFailed(true);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Side stage: the second concurrent session in this category.
          Focusing it swaps which tournament the surface/chat/bracket track. */}
      <div className="rounded-xl border border-card-border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted">
            Side stage
          </h3>
          {side && (
            <button
              type="button"
              onClick={onToggleFocus}
              className="rounded-full border border-card-border px-3 py-1 text-xs font-medium transition hover:border-brand-purple"
            >
              {sideFocused ? "Back to main" : "Watch"}
            </button>
          )}
        </div>
        {side ? (
          <div className="text-sm">
            <div className="font-semibold">{sanitizeAnswer(side.seeker)}</div>
            <div className="text-xs text-muted">{PHASE_LABELS[side.phase]}</div>
          </div>
        ) : (
          <p className="text-sm text-muted">Empty — next in queue takes it.</p>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-card-border bg-card p-4">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-widest text-muted">
          Take the stage
        </h3>
        {appliedPosition === null ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void apply();
            }}
          >
            <input
              value={myName}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Stage name (shown publicly)"
              maxLength={60}
              className="rounded-full border border-card-border bg-background px-4 py-2 text-sm outline-none transition focus:border-brand-purple"
            />
            <button
              type="submit"
              disabled={offline || applying || myName.trim() === ""}
              className="rounded-full bg-gradient-to-r from-brand-pink to-brand-purple px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              {applying ? "Applying…" : "Apply for the stage"}
            </button>
            {offline && (
              <p className="text-xs text-muted">
                Stage backend isn’t reachable right now — applications open as
                soon as it is.
              </p>
            )}
            {failed && (
              <p className="text-xs text-red-400">
                Application didn’t go through. Try again in a moment.
              </p>
            )}
          </form>
        ) : (
          <p className="text-sm text-muted">
            You’re <span className="font-semibold text-foreground">#{appliedPosition}</span>{" "}
            in the queue as{" "}
            <span className="font-semibold text-foreground">
              {sanitizeAnswer(myName)}
            </span>
            . The host calls you up automatically.
          </p>
        )}

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          <h4 className="mb-1 text-xs font-bold uppercase tracking-widest text-muted">
            Queue ({queue.length})
          </h4>
          {queue.length === 0 ? (
            <p className="text-sm text-muted">Nobody waiting — it’s all yours.</p>
          ) : (
            <ol className="space-y-1 text-sm">
              {queue.map((entry) => (
                <li key={entry.position} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-right font-mono text-xs text-muted">
                    {entry.position}.
                  </span>
                  <span className="truncate">
                    {sanitizeAnswer(entry.displayName)}
                    {entry.displayName === myName && (
                      <span className="ml-1 text-xs text-brand-pink">(you)</span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
