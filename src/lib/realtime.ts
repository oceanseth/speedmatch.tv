/**
 * Browser client for a Higgs Realtime voice session with the orchestrator.
 *
 * Flow: mint an ephemeral client secret from our token broker
 * (POST /api/realtime/token — BOSON_API_KEY never reaches this client, and
 * the broker enforces owner-only minting), then open a WebSocket to the
 * OpenAI-Realtime-compatible endpoint using the `bai-client-secret.<key>`
 * subprotocol. Mic audio goes up as base64 PCM16@24kHz via
 * `input_audio_buffer.append`; agent audio comes back as PCM16 deltas and
 * is scheduled onto an AudioContext. Server VAD owns turn-taking; a
 * `speech_started` event flushes local playback so the user can barge in.
 */

const REALTIME_URL = "wss://api.boson.ai/v1/realtime?model=higgs-realtime";
const SAMPLE_RATE = 24_000;
/** ~100ms of mic audio per append frame. */
const MIC_FRAME_SAMPLES = 2_400;

export type RealtimeStatus =
  | "connecting"
  | "connected"
  | "listening"
  | "speaking"
  | "closed"
  | "error";

export interface RealtimeCallbacks {
  onStatus?: (status: RealtimeStatus) => void;
  /** Incremental transcript of what the agent is saying (captions). */
  onCaption?: (delta: string, done: boolean) => void;
  onError?: (message: string) => void;
}

const WORKLET_SRC = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

function floatToPcm16Base64(samples: Float32Array): string {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function pcm16Base64ToFloat(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 0x8000;
  return out;
}

export class RealtimeVoiceSession {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private micNode: AudioWorkletNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micBuffer: Float32Array = new Float32Array(0);
  private playHead = 0;
  private playing = new Set<AudioBufferSourceNode>();
  private closed = false;

  constructor(private cb: RealtimeCallbacks = {}) {}

  /**
   * `micStream` must come from a user gesture (autoplay policy) and stays
   * owned by the caller — we tap its audio track, we never stop it.
   */
  async connect(tournamentId: string, micStream: MediaStream): Promise<void> {
    this.cb.onStatus?.("connecting");

    const minted = await fetch("/api/realtime/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tournamentId }),
    });
    if (!minted.ok) throw new Error(`token mint failed (${minted.status})`);
    const body = await minted.json();
    // Broker responses may nest the secret (OpenAI-compatible shape) or
    // return it flat; accept both so the broker stays free to evolve.
    const secret: unknown =
      body?.client_secret?.value ?? body?.client_secret ?? body?.value;
    if (typeof secret !== "string" || secret.length === 0) {
      throw new Error("mint response had no client secret");
    }

    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    await this.ctx.audioWorklet.addModule(
      URL.createObjectURL(new Blob([WORKLET_SRC], { type: "text/javascript" })),
    );

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(REALTIME_URL, [
        "realtime",
        `bai-client-secret.${secret}`,
      ]);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("realtime socket failed to open"));
      ws.onclose = () => {
        if (!this.closed) {
          this.cb.onStatus?.("closed");
          this.teardownAudio();
        }
      };
      ws.onmessage = (msg) => this.handleServerEvent(String(msg.data));
    });

    this.send({
      type: "session.update",
      session: {
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        turn_detection: { type: "server_vad" },
      },
    });

    this.micSource = this.ctx.createMediaStreamSource(micStream);
    this.micNode = new AudioWorkletNode(this.ctx, "pcm-capture");
    this.micNode.port.onmessage = (e: MessageEvent<Float32Array>) =>
      this.pushMic(e.data);
    // Worklet output stays unrouted on purpose — no local mic monitor.
    this.micSource.connect(this.micNode);

    this.cb.onStatus?.("connected");
  }

  private pushMic(chunk: Float32Array) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const merged = new Float32Array(this.micBuffer.length + chunk.length);
    merged.set(this.micBuffer);
    merged.set(chunk, this.micBuffer.length);
    let offset = 0;
    while (merged.length - offset >= MIC_FRAME_SAMPLES) {
      this.send({
        type: "input_audio_buffer.append",
        audio: floatToPcm16Base64(
          merged.subarray(offset, offset + MIC_FRAME_SAMPLES),
        ),
      });
      offset += MIC_FRAME_SAMPLES;
    }
    this.micBuffer = merged.slice(offset);
  }

  private handleServerEvent(raw: string) {
    let evt: { type?: string; delta?: string; error?: { message?: string } };
    try {
      evt = JSON.parse(raw);
    } catch {
      return;
    }
    switch (evt.type) {
      case "input_audio_buffer.speech_started":
        // Barge-in: the user started talking; drop queued agent audio.
        this.flushPlayback();
        this.cb.onStatus?.("listening");
        break;
      // Both current and legacy OpenAI-Realtime event names, so a Boson
      // API-version bump doesn't silently mute the stage.
      case "response.output_audio.delta":
      case "response.audio.delta":
        if (evt.delta) {
          this.enqueueAudio(evt.delta);
          this.cb.onStatus?.("speaking");
        }
        break;
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
        if (evt.delta) this.cb.onCaption?.(evt.delta, false);
        break;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        this.cb.onCaption?.("", true);
        break;
      case "response.done":
        this.cb.onStatus?.("connected");
        break;
      case "error":
        this.cb.onError?.(evt.error?.message ?? "realtime error");
        break;
    }
  }

  private enqueueAudio(b64: string) {
    const ctx = this.ctx;
    if (!ctx) return;
    const samples = pcm16Base64ToFloat(b64);
    if (samples.length === 0) return;
    const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, this.playHead);
    source.start(startAt);
    this.playHead = startAt + buffer.duration;
    this.playing.add(source);
    source.onended = () => this.playing.delete(source);
  }

  private flushPlayback() {
    for (const source of this.playing) {
      try {
        source.stop();
      } catch {
        // already ended
      }
    }
    this.playing.clear();
    this.playHead = 0;
  }

  private teardownAudio() {
    this.flushPlayback();
    this.micNode?.port.close();
    this.micNode?.disconnect();
    this.micSource?.disconnect();
    this.micNode = null;
    this.micSource = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.teardownAudio();
    this.ws?.close();
    this.ws = null;
    this.cb.onStatus?.("closed");
  }

  private send(event: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }
}
