"use client";

import { useEffect, useRef, useState } from "react";
import {
  BroadcastRecorder,
  type BroadcastChunkRef,
  type BroadcastStatus,
  type BroadcastTransport,
} from "../../../lib/broadcast";
import BroadcastViewer from "../../../components/stage/BroadcastViewer";

declare global {
  interface Window {
    /** Probe for automated verification of the loopback harness. */
    __broadcastLoopback?: {
      uploaded: number;
      manifest: number;
      status: BroadcastStatus | "idle";
    };
  }
}

/** In-memory stand-in for the storage bucket: "uploads" become object
 * URLs, which the viewer fetches exactly like presigned GETs. */
function loopbackTransport(
  onChunk: (ref: BroadcastChunkRef) => void,
): BroadcastTransport {
  const keys = new Map<string, number>();
  return {
    async mintChunkUrl(_id, chunk) {
      const url = `loopback:${chunk.seq}`;
      keys.set(url, chunk.seq);
      return { url };
    },
    async putChunk(url, blob) {
      const seq = keys.get(url);
      if (seq === undefined) return false;
      onChunk({ seq, url: URL.createObjectURL(blob) });
      return true;
    },
    async revoke() {},
  };
}

export default function BroadcastLoopbackHarness() {
  const [status, setStatus] = useState<BroadcastStatus>("idle");
  const [uploaded, setUploaded] = useState(0);
  const [manifest, setManifest] = useState<BroadcastChunkRef[]>([]);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<BroadcastRecorder | null>(null);

  useEffect(() => {
    window.__broadcastLoopback = {
      uploaded,
      manifest: manifest.length,
      status,
    };
  }, [uploaded, manifest.length, status]);

  const start = async () => {
    if (recorderRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    if (previewRef.current) previewRef.current.srcObject = stream;
    const recorder = new BroadcastRecorder(
      "loopback",
      stream,
      loopbackTransport((ref) => setManifest((prev) => [...prev, ref])),
      {
        onStatus: (s) => setStatus(s),
        onChunkUploaded: () => setUploaded((n) => n + 1),
      },
    );
    recorderRef.current = recorder;
    recorder.start();
  };

  const stop = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
  };

  return (
    <main className="mx-auto grid max-w-5xl gap-4 p-6 lg:grid-cols-2">
      <section className="flex flex-col gap-2">
        <h1 className="text-sm font-bold uppercase tracking-widest text-muted">
          Broadcaster (local camera → chunks)
        </h1>
        <div className="aspect-video overflow-hidden rounded-xl border border-card-border bg-card">
          <video
            ref={previewRef}
            muted
            playsInline
            autoPlay
            className="h-full w-full object-cover"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void start()}
            className="rounded-full bg-gradient-to-r from-brand-pink to-brand-purple px-4 py-1.5 text-sm font-semibold text-white"
          >
            Start
          </button>
          <button
            type="button"
            onClick={stop}
            className="rounded-full border border-card-border px-4 py-1.5 text-sm"
          >
            Stop
          </button>
          <span className="text-xs text-muted">
            status {status} · uploaded {uploaded}
          </span>
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h1 className="text-sm font-bold uppercase tracking-widest text-muted">
          Viewer (manifest → MSE player)
        </h1>
        <div className="aspect-video overflow-hidden rounded-xl border border-card-border bg-card">
          <BroadcastViewer manifest={manifest} />
        </div>
        <span className="text-xs text-muted">
          manifest entries: {manifest.length}
        </span>
      </section>
    </main>
  );
}
