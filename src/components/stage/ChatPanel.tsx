"use client";

import { useEffect, useRef, useState } from "react";
import { sanitizeAnswer } from "../../lib/onboarding";

/** Confirmed with the backend: chat text capped at 280 chars server-side. */
export const CHAT_MAX_CHARS = 280;

export interface ChatMessage {
  key: string;
  displayName: string;
  text: string;
  /** Phase transitions and other non-user lines. */
  system?: boolean;
}

interface Props {
  messages: ChatMessage[];
  /** Resolves false when the send was rejected. */
  onSend: (text: string) => Promise<boolean>;
  disabledReason: string | null;
}

export default function ChatPanel({ messages, onSend, disabledReason }: Props) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async () => {
    const text = sanitizeAnswer(draft, CHAT_MAX_CHARS);
    if (!text || sending) return;
    setSending(true);
    setFailed(false);
    const ok = await onSend(text);
    setSending(false);
    if (ok) setDraft("");
    else setFailed(true);
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="pt-6 text-center text-sm text-muted">
            {disabledReason ?? "No messages yet — say hi to the stage."}
          </p>
        )}
        {messages.map((m) =>
          m.system ? (
            <div
              key={m.key}
              className="text-center text-[10px] font-bold uppercase tracking-widest text-muted"
            >
              — {m.text} —
            </div>
          ) : (
            <div key={m.key} className="text-sm leading-snug">
              {/* User-derived text: sanitized at ingest server-side and
                  again here at the render boundary. */}
              <span className="font-semibold text-brand-pink">
                {sanitizeAnswer(m.displayName)}
              </span>{" "}
              <span className="text-foreground/90">
                {sanitizeAnswer(m.text, CHAT_MAX_CHARS)}
              </span>
            </div>
          ),
        )}
      </div>
      <form
        className="flex items-center gap-2 border-t border-card-border/60 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, CHAT_MAX_CHARS))}
          disabled={disabledReason !== null || sending}
          placeholder={disabledReason ?? "Message the stage…"}
          className="min-w-0 flex-1 rounded-full border border-card-border bg-background px-4 py-2 text-sm outline-none transition focus:border-brand-purple disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabledReason !== null || sending || draft.trim() === ""}
          className="rounded-full bg-gradient-to-r from-brand-pink to-brand-purple px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
        >
          {sending ? "…" : "Send"}
        </button>
      </form>
      {failed && (
        <p className="px-4 pb-2 text-xs text-red-400">
          Couldn’t send — the stage may be rate-limiting chat. Try again.
        </p>
      )}
    </div>
  );
}
