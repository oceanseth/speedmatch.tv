/**
 * Browser client for a Higgs Realtime voice session with the orchestrator.
 *
 * Flow: mint an ephemeral client secret from our token broker
 * (POST /api/realtime/token — BOSON_API_KEY never reaches this client, and
 * the broker enforces owner-only minting), then open a WebSocket using the
 * `wsUrl` and `subprotocols` the broker returns, so endpoint and auth
 * framing can't drift between the two sides. Mic audio goes up as base64
 * PCM16@24kHz via `input_audio_buffer.append`; agent audio comes back as
 * PCM16 deltas and is scheduled onto an AudioContext. Server VAD owns
 * turn-taking; a `speech_started` event flushes local playback so the user
 * can barge in. Established-session survival past key expiry is unverified.
 * Boson closes an invalid/expired key with code 3000, so on 3000 we re-mint and
 * reconnect (capped) instead of silently ending the session.
 */

const SAMPLE_RATE = 24_000;
/** ~100ms of mic audio per append frame. */
const MIC_FRAME_SAMPLES = 2_400;
/** Re-mint + reconnect budget for close code 3000 (expired/invalid key). */
const MAX_RECONNECT_ATTEMPTS = 3;

export type RealtimeStatus =
  | "connecting"
  | "connected"
  | "listening"
  | "speaking"
  | "closed"
  | "error";

export interface RealtimeConnectOptions {
  /** Fixed application prompt, never an authorization or tournament-state boundary. */
  instructions?: string;
}

export interface RealtimeCallbacks {
  onStatus?: (status: RealtimeStatus) => void;
  /** Incremental transcript of what the agent is saying (captions). */
  onCaption?: (delta: string, done: boolean) => void;
  /** Transcript of what the user said (higgs-stt-3.1 input transcription). */
  onUserCaption?: (delta: string, done: boolean) => void;
  onError?: (message: string) => void;
}

/** Contract of POST /api/realtime/token (server/src/boson/tokenBroker.ts). */
interface MintedSession {
  clientSecret: string;
  wsUrl: string;
  subprotocols: string[];
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
  private tournamentId = "";
  private reconnectAttempts = 0;
  private started = false;
  private abort = new AbortController();
  private cancelOpen: (() => void) | null = null;
  private options: RealtimeConnectOptions = {};

  constructor(private cb: RealtimeCallbacks = {}) {}

  /**
   * `micStream` must come from a user gesture (autoplay policy) and stays
   * owned by the caller — we tap its audio track, we never stop it.
   */
  async connect(tournamentId: string, micStream: MediaStream, options: RealtimeConnectOptions = {}): Promise<void> {
    if (this.started || this.closed) throw new Error("Voice session already used");
    this.started = true;
    this.tournamentId = tournamentId;
    this.options = options;
    this.cb.onStatus?.("connecting");
    try {
      // Resume before any network await can lose the initiating user gesture.
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      await this.ctx.resume();
      this.ensureOpen();
      const workletUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "text/javascript" }));
      try { await this.ctx.audioWorklet.addModule(workletUrl); }
      finally { URL.revokeObjectURL(workletUrl); }
      this.ensureOpen();
      await this.connectSocket();
      this.ensureOpen();
      this.micSource = this.ctx.createMediaStreamSource(micStream);
      this.micNode = new AudioWorkletNode(this.ctx, "pcm-capture");
      this.micNode.port.onmessage = (e: MessageEvent<Float32Array>) => this.pushMic(e.data);
      this.micSource.connect(this.micNode);
      this.cb.onStatus?.("connected");
    } catch (error) {
      this.close();
      throw error;
    }
  }

  private ensureOpen() {
    if (this.closed) throw new Error("Voice session closed");
  }

  private async connectSocket(): Promise<void> {
    while (true) {
      this.ensureOpen();
      const minted = await this.mint();
      this.ensureOpen();
      try {
        await this.openSocket(minted);
        this.ensureOpen();
        this.configureSession();
        return;
      } catch (error) {
        if (this.closed || !(error instanceof ExpiredCredential) ||
            this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) throw error;
        this.reconnectAttempts++;
      }
    }
  }

  private async mint(): Promise<MintedSession> {
    // Idempotent; establishes the httpOnly sm_sid session cookie the broker
    // route requires (401 without it).
    const timeout = setTimeout(() => this.abort.abort(), 15_000);
    try {
    const bootstrap = await fetch("/api/session", { cache: "no-store", signal: this.abort.signal });
    if (!bootstrap.ok) throw new Error("Voice session setup failed");
    this.ensureOpen();
    const res = await fetch("/api/realtime/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tournamentId: this.tournamentId }),
      signal: this.abort.signal,
    });
    if (!res.ok) throw new Error(`token mint failed (${res.status})`);
    const body = (await res.json()) as Partial<MintedSession>;
    this.ensureOpen();
    if (typeof body.clientSecret !== "string" || body.clientSecret.length === 0) {
      throw new Error("mint response had no clientSecret");
    }
    if (typeof body.wsUrl !== "string" || body.wsUrl.length === 0) {
      throw new Error("mint response had no wsUrl");
    }
    if (
      !Array.isArray(body.subprotocols) ||
      body.subprotocols.length === 0 ||
      !body.subprotocols.every((s) => typeof s === "string")
    ) {
      throw new Error("mint response had no subprotocols");
    }
    return {
      clientSecret: body.clientSecret,
      wsUrl: body.wsUrl,
      subprotocols: body.subprotocols,
    };
    } finally { clearTimeout(timeout); }
  }

  private openSocket(minted: MintedSession): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(minted.wsUrl, minted.subprotocols);
      this.ws = ws;
      let settled = false;
      const timer = setTimeout(() => finish(new Error("Voice connection timed out")), 15_000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.cancelOpen = null;
        if (error) { ws.onclose = null; ws.close(); reject(error); }
        else resolve();
      };
      this.cancelOpen = () => finish(new Error("Voice session closed"));
      ws.onopen = () => {
        if (this.closed) { finish(new Error("Voice session closed")); return; }
        finish();
      };
      ws.onerror = () => {
        if (this.closed || this.ws !== ws) return;
        if (!settled) finish(new Error("Voice socket failed to open"));
        else { this.cb.onError?.("Voice connection interrupted"); this.close(); }
      };
      ws.onclose = (event) => {
        if (this.closed || this.ws !== ws) return;
        if (!settled) {
          // The original connect() owns initial recovery; never strand its promise.
          finish(event.code === 3000 ? new ExpiredCredential() : new Error("Voice socket closed before setup"));
        } else void this.handleSocketClose(event);
      };
      ws.onmessage = message => {
        if (!this.closed && this.ws === ws) this.handleServerEvent(String(message.data));
      };
    });
  }

  private async handleSocketClose(event: CloseEvent): Promise<void> {
    if (this.closed) return;
    this.flushPlayback();
    this.micBuffer = new Float32Array(0);
    if (event.code === 3000 && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts++;
      this.cb.onStatus?.("connecting");
      try {
        await this.connectSocket();
        if (!this.closed) this.cb.onStatus?.("connected");
        return;
      } catch {
        if (!this.closed) this.cb.onError?.("Voice reconnect failed. Please try again.");
      }
    }
    this.close();
  }

  private configureSession() {
    // Boson's documented (nested) session shape — flat OpenAI-beta names are
    // ignored by this endpoint. Input transcription is off unless a model is
    // named, and without it no user-side caption events are emitted.
    this.send({
      type: "session.update",
      session: {
        ...(this.options.instructions ? { instructions: this.options.instructions } : {}),
        output_modalities: ["audio"],
        audio: {
          input: {
            turn_detection: { type: "server_vad" },
            transcription: { model: "higgs-stt-3.1" },
          },
        },
      },
    });
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
    let evt: {
      type?: string;
      delta?: string;
      transcript?: string;
      error?: { message?: string };
    };
    try {
      evt = JSON.parse(raw);
    } catch {
      return;
    }
    if (!evt || typeof evt !== "object") return;
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
      case "conversation.item.input_audio_transcription.delta":
        if (evt.delta) this.cb.onUserCaption?.(evt.delta, false);
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.cb.onUserCaption?.(evt.transcript ?? "", true);
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
    this.abort.abort();
    this.cancelOpen?.();
    this.micBuffer = new Float32Array(0);
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

class ExpiredCredential extends Error {
  constructor() { super("Voice credential expired"); }
}
