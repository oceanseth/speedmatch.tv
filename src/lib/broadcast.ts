/**
 * Client half of the spectator video pipeline (design of record, channel
 * 2026-09-18): the stage-holder's camera is cut into short self-contained
 * webm chunks and uploaded to object storage; viewers fetch chunks in
 * sequence off a manifest that rides the existing tournament events poll.
 * Expected viewer latency is a handful of seconds — the bracket/chat stay
 * the real-time layer.
 *
 * Chunks are self-contained (the recorder is restarted per chunk rather
 * than using one long recording with timeslice) so a viewer can join
 * mid-show at any sequence number without needing chunk 0's headers.
 *
 * Security constraints baked in from review (not retrofittable):
 * - Every chunk requests its own single-object upload URL; the server
 *   re-checks stage ownership on every mint. A denied mint therefore
 *   means the stage is no longer ours — capture stops immediately.
 * - Broadcasting is opt-in per stage-take, default off, and revocable:
 *   `revoke()` both stops capture and asks the server to delete the
 *   chunks already uploaded, not just stop accepting new ones.
 *
 * The server routes do not exist yet; their shapes below are provisional
 * (mirroring the stage.ts approach). When the mint/manifest contract
 * lands, only `httpBroadcastTransport` and the manifest event type here
 * should need to change.
 */

/** Target duration of one self-contained chunk. */
export const CHUNK_MS = 2_000;
/** Chunks queued or in flight beyond this are dropped oldest-first: for a
 * live feed, staying near the edge beats completeness. */
export const MAX_PENDING_UPLOADS = 3;
/** Consecutive upload failures before the broadcast gives up. */
export const MAX_UPLOAD_FAILURES = 3;
/** session_events type carrying one manifest entry per uploaded chunk. */
export const BROADCAST_CHUNK_EVENT = "BROADCAST_CHUNK";
/** Manifest entries kept client-side (~2 min of show at CHUNK_MS). */
export const MAX_MANIFEST_ENTRIES = 60;
/** On joining a live manifest, start this many chunks behind the tail. */
export const LIVE_JOIN_BACKLOG = 3;

export const BROADCAST_MIME_CANDIDATES = [
  'video/webm;codecs="vp8,opus"',
  "video/webm",
] as const;

export type BroadcastStatus =
  | "idle"
  | "broadcasting"
  | "stopped"
  | "error";

export type BroadcastStopReason =
  | "stopped" // local stop (leave stage / toggle off)
  | "revoked" // consent withdrawn — server also deletes uploaded chunks
  | "denied" // mint refused: we no longer hold the stage
  | "upload-failed"
  | "recorder-failed";

export interface BroadcastChunkRef {
  seq: number;
  url: string;
}

export interface BroadcastTransport {
  /**
   * Request a presigned single-object PUT for exactly this chunk. The
   * server derives the object key from the tournament and sequence it
   * owns, fixes content type and length, and re-checks that the caller's
   * session currently holds the stage. `null` means denied — the caller
   * must treat that as loss of the stage and stop.
   */
  mintChunkUrl(
    tournamentId: string,
    chunk: { seq: number; contentType: string; contentLength: number },
  ): Promise<{ url: string } | null>;
  putChunk(url: string, blob: Blob, contentType: string): Promise<boolean>;
  /** Withdraw consent: stop accepting mints and delete uploaded chunks. */
  revoke(tournamentId: string): Promise<void>;
}

/** Provisional HTTP shapes — confirm against the server PR before relying
 * on them; every failure path degrades to "broadcast stops". */
export function httpBroadcastTransport(): BroadcastTransport {
  return {
    async mintChunkUrl(tournamentId, chunk) {
      try {
        const res = await fetch(
          `/api/tournaments/${encodeURIComponent(tournamentId)}/broadcast/mint`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(chunk),
          },
        );
        if (!res.ok) return null;
        const data = (await res.json()) as { url?: unknown };
        return typeof data.url === "string" ? { url: data.url } : null;
      } catch {
        return null;
      }
    },
    async putChunk(url, blob, contentType) {
      try {
        const res = await fetch(url, {
          method: "PUT",
          headers: { "content-type": contentType },
          body: blob,
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    async revoke(tournamentId) {
      try {
        await fetch(
          `/api/tournaments/${encodeURIComponent(tournamentId)}/broadcast/revoke`,
          { method: "POST" },
        );
      } catch {
        // Best-effort from this client; the server-side per-chunk
        // ownership re-check is the enforcement layer.
      }
    },
  };
}

/** The subset of MediaRecorder the broadcaster uses, injectable in tests. */
export interface RecorderLike {
  start(): void;
  stop(): void;
  state: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
}

export interface BroadcastCallbacks {
  onStatus?: (status: BroadcastStatus, reason?: BroadcastStopReason) => void;
  /** A chunk was accepted by storage (drives the REC indicator honestly). */
  onChunkUploaded?: (seq: number) => void;
}

interface BroadcastDeps {
  createRecorder?: (stream: MediaStream, mimeType: string) => RecorderLike;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
}

export function pickBroadcastMime(
  isSupported: (mime: string) => boolean,
): string | null {
  for (const mime of BROADCAST_MIME_CANDIDATES) {
    if (isSupported(mime)) return mime;
  }
  return null;
}

/**
 * Records a MediaStream as self-contained ~CHUNK_MS webm chunks and
 * uploads each through the transport, minting a fresh single-object URL
 * per chunk. Stops itself on mint denial, repeated upload failure, or
 * recorder error; `stop()`/`revoke()` stop it locally.
 */
export class BroadcastRecorder {
  private status: BroadcastStatus = "idle";
  private recorder: RecorderLike | null = null;
  private chunkTimer: ReturnType<typeof setTimeout> | null = null;
  private nextSeq = 0;
  private pending: { seq: number; blob: Blob }[] = [];
  private uploading = false;
  private consecutiveFailures = 0;
  private readonly mimeType: string;

  constructor(
    private readonly tournamentId: string,
    private readonly stream: MediaStream,
    private readonly transport: BroadcastTransport,
    private readonly callbacks: BroadcastCallbacks = {},
    private readonly deps: BroadcastDeps = {},
  ) {
    const isSupported =
      typeof MediaRecorder !== "undefined"
        ? (mime: string) => MediaRecorder.isTypeSupported(mime)
        : () => true;
    this.mimeType = pickBroadcastMime(isSupported) ?? "video/webm";
  }

  get currentStatus(): BroadcastStatus {
    return this.status;
  }

  start(): void {
    if (this.status !== "idle") return;
    this.setStatus("broadcasting");
    this.startChunk();
  }

  /** Local stop — recorded chunks stay for replay per their server TTL. */
  stop(): void {
    this.finish("stopped", "stopped");
  }

  /** Consent withdrawal — also deletes what was already uploaded. */
  async revoke(): Promise<void> {
    this.finish("stopped", "revoked");
    await this.transport.revoke(this.tournamentId);
  }

  private setStatus(status: BroadcastStatus, reason?: BroadcastStopReason) {
    this.status = status;
    this.callbacks.onStatus?.(status, reason);
  }

  private finish(status: BroadcastStatus, reason: BroadcastStopReason) {
    if (this.status !== "broadcasting") return;
    this.teardownRecorder();
    this.pending = [];
    this.setStatus(status, reason);
  }

  private teardownRecorder() {
    if (this.chunkTimer !== null) {
      (this.deps.clearTimer ?? clearTimeout)(this.chunkTimer);
      this.chunkTimer = null;
    }
    const rec = this.recorder;
    this.recorder = null;
    if (rec && rec.state === "recording") {
      // Detach handlers first so the final flush doesn't queue an upload.
      rec.ondataavailable = null;
      rec.onstop = null;
      try {
        rec.stop();
      } catch {
        // Already stopped.
      }
    }
  }

  private createRecorder(): RecorderLike {
    const create =
      this.deps.createRecorder ??
      ((stream: MediaStream, mimeType: string) =>
        new MediaRecorder(stream, { mimeType }) as unknown as RecorderLike);
    return create(this.stream, this.mimeType);
  }

  /** One start→stop cycle per chunk keeps every chunk self-contained. */
  private startChunk() {
    if (this.status !== "broadcasting") return;
    let rec: RecorderLike;
    try {
      rec = this.createRecorder();
    } catch {
      this.finish("error", "recorder-failed");
      return;
    }
    this.recorder = rec;
    rec.ondataavailable = (event) => {
      if (this.status !== "broadcasting") return;
      if (event.data && event.data.size > 0) {
        this.enqueue({ seq: this.nextSeq++, blob: event.data });
      }
    };
    rec.onstop = () => {
      if (this.recorder === rec) this.recorder = null;
      this.startChunk();
    };
    rec.onerror = () => this.finish("error", "recorder-failed");
    try {
      rec.start();
    } catch {
      this.finish("error", "recorder-failed");
      return;
    }
    this.chunkTimer = (this.deps.setTimer ?? setTimeout)(() => {
      this.chunkTimer = null;
      if (this.status === "broadcasting" && rec.state === "recording") {
        rec.stop();
      }
    }, CHUNK_MS);
  }

  private enqueue(chunk: { seq: number; blob: Blob }) {
    this.pending.push(chunk);
    // Live edge beats completeness: shed the oldest waiting chunks.
    while (this.pending.length > MAX_PENDING_UPLOADS) {
      this.pending.shift();
    }
    void this.drain();
  }

  private async drain() {
    if (this.uploading) return;
    this.uploading = true;
    try {
      while (this.status === "broadcasting" && this.pending.length > 0) {
        const chunk = this.pending.shift()!;
        const minted = await this.transport.mintChunkUrl(this.tournamentId, {
          seq: chunk.seq,
          contentType: this.mimeType,
          contentLength: chunk.blob.size,
        });
        if (this.status !== "broadcasting") return;
        if (!minted) {
          // Ownership re-check failed — we no longer hold the stage.
          this.finish("stopped", "denied");
          return;
        }
        const ok = await this.transport.putChunk(
          minted.url,
          chunk.blob,
          this.mimeType,
        );
        if (this.status !== "broadcasting") return;
        if (ok) {
          this.consecutiveFailures = 0;
          this.callbacks.onChunkUploaded?.(chunk.seq);
        } else {
          this.consecutiveFailures += 1;
          if (this.consecutiveFailures >= MAX_UPLOAD_FAILURES) {
            this.finish("error", "upload-failed");
            return;
          }
        }
      }
    } finally {
      this.uploading = false;
    }
  }
}

/**
 * Fold BROADCAST_CHUNK session events into the viewer's manifest.
 * Tolerates malformed payloads and duplicate seqs; keeps the newest
 * MAX_MANIFEST_ENTRIES in ascending seq order.
 */
export function foldManifest(
  prev: BroadcastChunkRef[],
  events: { type: string; payload: Record<string, unknown> }[],
): BroadcastChunkRef[] {
  const additions: BroadcastChunkRef[] = [];
  for (const evt of events) {
    if (evt.type !== BROADCAST_CHUNK_EVENT) continue;
    const { seq, url } = evt.payload;
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) continue;
    if (typeof url !== "string" || url === "") continue;
    additions.push({ seq, url });
  }
  if (additions.length === 0) return prev;
  const bySeq = new Map<number, BroadcastChunkRef>();
  for (const ref of prev) bySeq.set(ref.seq, ref);
  for (const ref of additions) bySeq.set(ref.seq, ref);
  return [...bySeq.values()]
    .sort((a, b) => a.seq - b.seq)
    .slice(-MAX_MANIFEST_ENTRIES);
}

/**
 * The next chunk a viewer should fetch. Fresh joins (lastAppended null)
 * start LIVE_JOIN_BACKLOG behind the tail; thereafter it's the lowest
 * available seq after the last appended one — gaps (dropped chunks) are
 * skipped rather than waited on.
 */
export function nextChunkToFetch(
  manifest: BroadcastChunkRef[],
  lastAppendedSeq: number | null,
): BroadcastChunkRef | null {
  if (manifest.length === 0) return null;
  if (lastAppendedSeq === null) {
    const tail = manifest[manifest.length - 1].seq;
    const startAt = tail - LIVE_JOIN_BACKLOG;
    return manifest.find((ref) => ref.seq >= startAt) ?? null;
  }
  return manifest.find((ref) => ref.seq > lastAppendedSeq) ?? null;
}
