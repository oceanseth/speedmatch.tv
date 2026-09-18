"use client";

import { useEffect, useRef, useState } from "react";
import {
  nextChunkToFetch,
  type BroadcastChunkRef,
} from "../../lib/broadcast";

/** Matches the recorder's first mime candidate; standalone webm chunks
 * append cleanly as long as the codecs line up. */
const MSE_MIME = 'video/webm; codecs="vp8,opus"';
/** Seconds of buffer kept behind the playhead before old ranges are evicted. */
const BUFFER_BEHIND_S = 30;
/** If the playhead falls this far behind the buffered end, jump to live. */
const MAX_DRIFT_S = 8;

/**
 * Spectator-side player for the broadcast chunk pipeline: fetches
 * self-contained webm chunks in manifest order and appends them to one
 * MediaSource buffer in "sequence" mode, so per-chunk timestamps (each
 * chunk starts at 0) become one continuous timeline. Joins near the live
 * edge and skips gaps — a missing chunk is a stutter, not a stall.
 */
export default function BroadcastViewer({
  manifest,
}: {
  manifest: BroadcastChunkRef[];
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [waiting, setWaiting] = useState(true);

  // MSE machinery lives in refs: it's imperative state the render doesn't
  // depend on, and the pump must survive manifest-effect re-runs.
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const lastAppendedSeqRef = useRef<number | null>(null);
  const pumpingRef = useRef(false);
  const manifestRef = useRef(manifest);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (
      typeof MediaSource === "undefined" ||
      !MediaSource.isTypeSupported(MSE_MIME)
    ) {
      // Deferred a tick, matching the repo pattern for post-hydration
      // state (react-hooks/set-state-in-effect is a hard error).
      const t = setTimeout(() => setUnsupported(true), 0);
      return () => clearTimeout(t);
    }
    const mediaSource = new MediaSource();
    const objectUrl = URL.createObjectURL(mediaSource);
    video.src = objectUrl;
    const onOpen = () => {
      if (mediaSource.readyState !== "open" || sourceBufferRef.current) return;
      const sb = mediaSource.addSourceBuffer(MSE_MIME);
      sb.mode = "sequence";
      sourceBufferRef.current = sb;
    };
    mediaSource.addEventListener("sourceopen", onOpen);
    return () => {
      mediaSource.removeEventListener("sourceopen", onOpen);
      sourceBufferRef.current = null;
      lastAppendedSeqRef.current = null;
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
      video.load();
    };
  }, []);

  // Pump loop: one chunk in flight at a time, re-kicked on every manifest
  // poll. Reads the manifest through a ref so a chunk that finishes after
  // a re-render still sees the newest entries.
  useEffect(() => {
    // Kept in a ref (updated here, not during render) so a chunk that
    // finishes after a re-render still sees the newest entries.
    manifestRef.current = manifest;
    let cancelled = false;
    const appendDone = (sb: SourceBuffer) =>
      new Promise<void>((resolve) => {
        const done = () => {
          sb.removeEventListener("updateend", done);
          sb.removeEventListener("error", done);
          resolve();
        };
        sb.addEventListener("updateend", done);
        sb.addEventListener("error", done);
      });
    const pump = async () => {
      if (pumpingRef.current) return;
      pumpingRef.current = true;
      try {
        while (!cancelled) {
          const sb = sourceBufferRef.current;
          const video = videoRef.current;
          if (!sb || !video || sb.updating) return;
          const next = nextChunkToFetch(
            manifestRef.current,
            lastAppendedSeqRef.current,
          );
          if (!next) return;
          let bytes: ArrayBuffer;
          try {
            const res = await fetch(next.url, { cache: "no-store" });
            if (!res.ok) throw new Error(String(res.status));
            bytes = await res.arrayBuffer();
          } catch {
            // Transient fetch failure: leave the cursor so the next poll
            // retries; an expired chunk URL ages out of the manifest.
            return;
          }
          if (cancelled || sourceBufferRef.current !== sb) return;
          try {
            const waited = appendDone(sb);
            sb.appendBuffer(bytes);
            await waited;
          } catch {
            // Quota pressure: evict the played-out range and retry the
            // same chunk on the next poll.
            evictBehind(sb, video);
            return;
          }
          lastAppendedSeqRef.current = next.seq;
          if (cancelled) return;
          setWaiting(false);
          keepNearLive(video);
          evictBehind(sb, video);
          if (sb.updating) await appendDone(sb);
        }
      } finally {
        pumpingRef.current = false;
      }
    };
    void pump();
    return () => {
      cancelled = true;
    };
  }, [manifest]);

  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className="h-full w-full object-cover"
      />
      {(waiting || unsupported) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
          <span className="flex items-center gap-2 rounded-full bg-red-500/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-red-400">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-red-400" />
            Live camera
          </span>
          <p className="max-w-sm px-4 text-sm text-muted">
            {unsupported
              ? "This browser can’t play the live camera feed."
              : "Connecting to the camera feed…"}
          </p>
        </div>
      )}
    </div>
  );
}

function keepNearLive(video: HTMLVideoElement) {
  const buffered = video.buffered;
  if (buffered.length === 0) return;
  const end = buffered.end(buffered.length - 1);
  if (video.currentTime > 0 && end - video.currentTime > MAX_DRIFT_S) {
    video.currentTime = end - 1;
  }
  if (video.paused) {
    void video.play().catch(() => {
      // Autoplay veto: the muted attribute normally prevents this; the
      // overlay copy keeps the state honest if it happens anyway.
    });
  }
}

function evictBehind(sb: SourceBuffer, video: HTMLVideoElement) {
  if (sb.updating) return;
  const buffered = video.buffered;
  if (buffered.length === 0) return;
  const cutoff = video.currentTime - BUFFER_BEHIND_S;
  if (cutoff > buffered.start(0)) {
    try {
      sb.remove(buffered.start(0), cutoff);
    } catch {
      // Eviction is opportunistic; quota errors surface on append instead.
    }
  }
}
