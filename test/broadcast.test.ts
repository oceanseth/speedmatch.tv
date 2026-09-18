import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BroadcastRecorder,
  LIVE_JOIN_BACKLOG,
  MAX_MANIFEST_ENTRIES,
  MAX_PENDING_UPLOADS,
  MAX_UPLOAD_FAILURES,
  foldManifest,
  nextChunkToFetch,
  pickBroadcastMime,
  type BroadcastStatus,
  type BroadcastStopReason,
  type BroadcastTransport,
  type RecorderLike,
} from "../src/lib/broadcast";

/** Yield until queued async work (mint/put promise chains) settles. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

class FakeRecorder implements RecorderLike {
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  /** Mirrors MediaRecorder: emits the buffered data, then the stop event. */
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(100)]) });
    this.onstop?.();
  }
}

function harness(options: {
  mint?: (seq: number) => { url: string } | null;
  put?: (seq: number) => boolean | Promise<boolean>;
} = {}) {
  const recorders: FakeRecorder[] = [];
  const timers: (() => void)[] = [];
  const mints: { seq: number; contentType: string; contentLength: number }[] = [];
  const puts: { url: string; size: number }[] = [];
  const uploaded: number[] = [];
  const statuses: { status: BroadcastStatus; reason?: BroadcastStopReason }[] = [];
  let revokes = 0;
  const transport: BroadcastTransport = {
    async mintChunkUrl(_id, chunk) {
      mints.push(chunk);
      return options.mint ? options.mint(chunk.seq) : { url: `put://${chunk.seq}` };
    },
    async putChunk(url, blob) {
      puts.push({ url, size: blob.size });
      return options.put ? options.put(puts.length - 1) : true;
    },
    async revoke() {
      revokes += 1;
    },
  };
  const recorder = new BroadcastRecorder(
    "t-1",
    {} as MediaStream,
    transport,
    {
      onStatus: (status, reason) => statuses.push({ status, reason }),
      onChunkUploaded: (seq) => uploaded.push(seq),
    },
    {
      createRecorder: () => {
        const rec = new FakeRecorder();
        recorders.push(rec);
        return rec;
      },
      setTimer: (fn) => {
        timers.push(fn);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => {},
    },
  );
  /** Fire the pending chunk timer: ends the current ~2s chunk. */
  const endChunk = () => timers.splice(0, timers.length).forEach((fn) => fn());
  return { recorder, recorders, mints, puts, uploaded, statuses, endChunk, revokeCount: () => revokes };
}

test("uploads each chunk with its own exact-scope mint, in sequence", async () => {
  const h = harness();
  h.recorder.start();
  assert.equal(h.recorders.length, 1);
  h.endChunk();
  await settle();
  h.endChunk();
  await settle();
  assert.deepEqual(h.mints, [
    { seq: 0, contentType: 'video/webm;codecs="vp8,opus"', contentLength: 100 },
    { seq: 1, contentType: 'video/webm;codecs="vp8,opus"', contentLength: 100 },
  ]);
  assert.deepEqual(h.puts.map((p) => p.url), ["put://0", "put://1"]);
  assert.deepEqual(h.uploaded, [0, 1]);
  // A new self-contained recording started after each chunk.
  assert.equal(h.recorders.length, 3);
  assert.equal(h.recorder.currentStatus, "broadcasting");
});

test("a denied mint means the stage is lost: capture stops immediately", async () => {
  const h = harness({ mint: (seq) => (seq === 1 ? null : { url: `put://${seq}` }) });
  h.recorder.start();
  h.endChunk();
  await settle();
  h.endChunk();
  await settle();
  assert.equal(h.recorder.currentStatus, "stopped");
  assert.deepEqual(h.statuses.at(-1), { status: "stopped", reason: "denied" });
  assert.equal(h.mints.length, 2);
  assert.deepEqual(h.uploaded, [0]);
  // Ending another chunk after the denial uploads nothing.
  h.endChunk();
  await settle();
  assert.equal(h.mints.length, 2);
});

test("gives up after consecutive upload failures, but a success resets the count", async () => {
  const mode = { failAll: false };
  let putCount = 0;
  const h = harness({
    put: () => {
      putCount += 1;
      if (mode.failAll) return false;
      return putCount !== 2; // one isolated failure among successes
    },
  });
  h.recorder.start();
  for (let i = 0; i < 2 + MAX_UPLOAD_FAILURES; i++) {
    h.endChunk();
    await settle();
  }
  assert.equal(h.recorder.currentStatus, "broadcasting");
  // Now fail MAX_UPLOAD_FAILURES times in a row.
  mode.failAll = true;
  const stopAt = h.mints.length + MAX_UPLOAD_FAILURES;
  while (h.mints.length < stopAt) {
    h.endChunk();
    await settle();
  }
  assert.deepEqual(h.statuses.at(-1), { status: "error", reason: "upload-failed" });
});

test("sheds oldest chunks past the pending cap instead of falling behind", async () => {
  const releasePuts: (() => void)[] = [];
  const h = harness({
    put: () => new Promise<boolean>((resolve) => releasePuts.push(() => resolve(true))),
  });
  h.recorder.start();
  // First chunk starts uploading and blocks; queue more than the cap behind it.
  for (let i = 0; i < MAX_PENDING_UPLOADS + 3; i++) {
    h.endChunk();
    await settle();
  }
  releasePuts.splice(0).forEach((fn) => fn());
  await settle();
  releasePuts.splice(0).forEach((fn) => fn());
  await settle();
  await settle();
  // Seq 0 was in flight; of the rest, only the newest MAX_PENDING_UPLOADS
  // survived the shed. Sequence numbers stay monotonic with a gap.
  assert.equal(h.uploaded[0], 0);
  const rest = h.uploaded.slice(1);
  assert.ok(rest.length <= MAX_PENDING_UPLOADS + 1);
  for (let i = 1; i < rest.length; i++) assert.ok(rest[i] > rest[i - 1]);
  assert.ok(rest[0] > 1, `expected shed before seq ${rest[0]}`);
});

test("stop() discards the in-progress chunk and uploads nothing more", async () => {
  const h = harness();
  h.recorder.start();
  h.endChunk();
  await settle();
  h.recorder.stop();
  h.endChunk();
  await settle();
  assert.deepEqual(h.uploaded, [0]);
  assert.deepEqual(h.statuses.at(-1), { status: "stopped", reason: "stopped" });
  assert.equal(h.revokeCount(), 0);
});

test("revoke() stops capture and asks the server to delete uploaded chunks", async () => {
  const h = harness();
  h.recorder.start();
  h.endChunk();
  await settle();
  await h.recorder.revoke();
  assert.deepEqual(h.statuses.at(-1), { status: "stopped", reason: "revoked" });
  assert.equal(h.revokeCount(), 1);
  h.endChunk();
  await settle();
  assert.deepEqual(h.uploaded, [0]);
});

test("start() is idempotent and does nothing after a stop", () => {
  const h = harness();
  h.recorder.start();
  h.recorder.start();
  assert.equal(h.recorders.length, 1);
  h.recorder.stop();
  h.recorder.start();
  assert.equal(h.recorders.length, 1);
});

test("pickBroadcastMime prefers vp8+opus and falls back to bare webm", () => {
  assert.equal(pickBroadcastMime(() => true), 'video/webm;codecs="vp8,opus"');
  assert.equal(pickBroadcastMime((m) => m === "video/webm"), "video/webm");
  assert.equal(pickBroadcastMime(() => false), null);
});

test("foldManifest keeps valid entries sorted, deduped, and capped", () => {
  const events = [
    { type: "BROADCAST_CHUNK", payload: { seq: 2, url: "u2" } },
    { type: "CHAT", payload: { seq: 9, url: "nope" } },
    { type: "BROADCAST_CHUNK", payload: { seq: "3", url: "bad-seq" } },
    { type: "BROADCAST_CHUNK", payload: { seq: 1, url: "" } },
    { type: "BROADCAST_CHUNK", payload: { seq: -1, url: "neg" } },
    { type: "BROADCAST_CHUNK", payload: { seq: 0, url: "u0" } },
    { type: "BROADCAST_CHUNK", payload: { seq: 2, url: "u2-again" } },
  ];
  const folded = foldManifest([], events);
  assert.deepEqual(folded, [
    { seq: 0, url: "u0" },
    { seq: 2, url: "u2-again" },
  ]);
  // No-op batches return the previous array untouched.
  assert.equal(foldManifest(folded, [{ type: "CHAT", payload: {} }]), folded);
  // Cap: only the newest MAX_MANIFEST_ENTRIES survive.
  const many = Array.from({ length: MAX_MANIFEST_ENTRIES + 10 }, (_, i) => ({
    type: "BROADCAST_CHUNK",
    payload: { seq: i, url: `u${i}` },
  }));
  const capped = foldManifest([], many);
  assert.equal(capped.length, MAX_MANIFEST_ENTRIES);
  assert.equal(capped[0].seq, 10);
});

test("nextChunkToFetch joins near the live edge and skips gaps", () => {
  const manifest = [4, 5, 7, 8].map((seq) => ({ seq, url: `u${seq}` }));
  assert.equal(nextChunkToFetch([], null), null);
  // Fresh join: LIVE_JOIN_BACKLOG behind the tail (8 - 3 = 5).
  assert.equal(nextChunkToFetch(manifest, null)?.seq, 8 - LIVE_JOIN_BACKLOG);
  // Gap between 5 and 7 is skipped, not waited on.
  assert.equal(nextChunkToFetch(manifest, 5)?.seq, 7);
  assert.equal(nextChunkToFetch(manifest, 8), null);
  // Short manifests join from their start.
  assert.equal(nextChunkToFetch(manifest.slice(0, 2), null)?.seq, 4);
});
