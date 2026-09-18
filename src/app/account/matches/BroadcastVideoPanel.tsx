"use client";

import { useEffect, useState } from "react";
import {
  forgetBroadcastUpload,
  httpBroadcastTransport,
  listBroadcastUploads,
  type RememberedBroadcast,
} from "../../../lib/broadcast";

/**
 * Consent surface for broadcast video: lists every show this browser
 * uploaded camera chunks to (local memory, cleared only on a
 * server-confirmed deletion) so "delete my video" stays reachable long
 * after the show — the place someone comes back to when they reconsider.
 * Renders nothing when there is nothing to delete.
 */
export default function BroadcastVideoPanel() {
  const [uploads, setUploads] = useState<RememberedBroadcast[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Deferred so hydration completes before localStorage-driven UI lands.
  useEffect(() => {
    const t = setTimeout(() => setUploads(listBroadcastUploads()), 0);
    return () => clearTimeout(t);
  }, []);

  if (uploads.length === 0) return null;

  const remove = async (tournamentId: string) => {
    if (pendingId) return;
    setPendingId(tournamentId);
    setError(null);
    const ok = await httpBroadcastTransport().revoke(tournamentId);
    if (ok) {
      forgetBroadcastUpload(tournamentId);
      setUploads(listBroadcastUploads());
    } else {
      setError("Couldn’t delete that video — try again.");
    }
    setPendingId(null);
  };

  return (
    <div className="mt-4 rounded-xl border border-card-border bg-card p-4">
      <div className="text-sm font-semibold">Broadcast video</div>
      <p className="mt-1 text-xs text-muted">
        Shows where you broadcast your camera to viewers from this browser.
        Deleting removes the uploaded video from the server, not just from
        this list.
      </p>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      <ul className="mt-3 space-y-2">
        {uploads.map((u) => (
          <li
            key={u.tournamentId}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="min-w-0 truncate text-muted">
              Show on{" "}
              {new Date(u.at).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            <button
              type="button"
              onClick={() => void remove(u.tournamentId)}
              disabled={pendingId !== null}
              className="shrink-0 rounded-full border border-red-400/60 px-3 py-1 text-xs font-medium text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
            >
              {pendingId === u.tournamentId ? "Deleting…" : "Delete my video"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
