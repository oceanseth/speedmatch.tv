import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { RealtimeVoiceSession } from "../src/lib/realtime";
import { createTokenBrokerHandler } from "../server/src/boson/tokenBroker";
import { onboardingInstructions } from "../src/lib/onboardingVoice";

function harness(t: TestContext, options: { firstClose?: number; sessionStatus?: number } = {}) {
  const sockets: FakeSocket[] = [];
  const contexts: FakeContext[] = [];
  const worklets: FakeWorklet[] = [];
  const calls: string[] = [];
  let sessionCookie = false;
  let mintCount = 0;
  const broker = createTokenBrokerHandler({
    authorize: async req => req.headers.get("cookie") === "sm_sid=test-session"
      ? { userId: "test-session", tournamentId: "lobby" } : null,
    clientKey: () => "test-client",
    mint: async () => ({ value: `bai-eph-test-${++mintCount}`, expiresAt: Math.floor(Date.now() / 1000) + 90, sessionId: "test" }),
  });
  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    sent: Record<string, unknown>[] = [];
    constructor(public url: string, public protocols: string[]) {
      sockets.push(this);
      queueMicrotask(() => {
        if (options.firstClose && sockets.length === 1) this.serverClose(options.firstClose);
        else { this.readyState = 1; this.onopen?.(); }
      });
    }
    send(raw: string) {
      const body = JSON.parse(raw); this.sent.push(body);
      if (body.type === "session.update") queueMicrotask(() => this.receive({ type: "session.created" }));
    }
    receive(body: object) { this.onmessage?.({ data: JSON.stringify(body) }); }
    serverClose(code: number) { this.readyState = 3; this.onclose?.({ code }); }
    close() { this.readyState = 3; }
  }
  class FakeNode {
    connected: unknown = null;
    connect(node: unknown) { this.connected = node; return node; }
    disconnect() { this.connected = null; }
  }
  class FakeWorklet extends FakeNode {
    port = { onmessage: null as ((event: { data: Float32Array }) => void) | null, close() {} };
    constructor() { super(); worklets.push(this); }
  }
  class FakeContext {
    state = "suspended";
    sampleRate = 24000;
    currentTime = 0;
    destination = {};
    sources: { stopped: boolean; buffer: { duration: number } | null; start: (at: number) => void; stop: () => void; connect: () => void; onended: (() => void) | null }[] = [];
    audioWorklet = { addModule: async () => {} };
    constructor() { contexts.push(this); }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
    createMediaStreamSource() { return new FakeNode(); }
    createGain() { return Object.assign(new FakeNode(), { gain: { value: 1 } }); }
    createBuffer(_channels: number, samples: number, rate: number) {
      const data = new Float32Array(samples);
      return { duration: samples / rate, getChannelData: () => data };
    }
    createBufferSource() {
      const source = { stopped: false, buffer: null as { duration: number } | null, start() {}, stop() { this.stopped = true; }, connect() {}, onended: null as (() => void) | null };
      this.sources.push(source); return source;
    }
  }
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    calls.push(input);
    if (input === "/api/session") { sessionCookie = (options.sessionStatus ?? 200) === 200; return Response.json({ ok: sessionCookie }, { status: options.sessionStatus ?? 200 }); }
    const request = new Request("https://speedmatch.test" + input, init);
    if (sessionCookie) request.headers.set("cookie", "sm_sid=test-session");
    return broker(request);
  });
  for (const [name, value] of Object.entries({ WebSocket: FakeSocket, AudioContext: FakeContext, AudioWorkletNode: FakeWorklet })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
  }
  const stream = { getTracks: () => [] } as unknown as MediaStream;
  return { sockets, contexts, worklets, calls, stream, get mintCount() { return mintCount; } };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("controlled onboarding suppresses VAD replies and only plays the current machine question", async t => {
  const h = harness(t); const captions: string[] = []; const answers: string[] = [];
  const client = new RealtimeVoiceSession({
    onCaption: (text, done) => { if (!done) captions.push(text); },
    onUserCaption: (text, done) => { if (done) answers.push(text); },
  });
  t.after(() => client.close());
  await client.connect("lobby", h.stream, {
    controlledResponses: true,
    instructions: onboardingInstructions({ nextField: "displayName", reply: "What should I call you?" }),
  });
  const ws = h.sockets[0];
  const first = ws.sent.find(e => e.type === "response.create")!;
  assert.match(JSON.stringify(first), /What should I call you/);
  ws.receive({ type: "response.created", response: { id: "initial", metadata: { app_turn: "1" } } });
  ws.receive({ type: "response.output_audio_transcript.delta", response_id: "initial", delta: "What should I call you?" });
  ws.receive({ type: "input_audio_buffer.speech_started" });
  ws.receive({ type: "response.created", response: { id: "late-initial", metadata: { app_turn: "1" } } });
  ws.receive({ type: "response.output_audio_transcript.delta", response_id: "late-initial", delta: "Old question" });
  ws.receive({ type: "conversation.item.input_audio_transcription.delta", item_id: "answer1", delta: "Al" });
  ws.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: "answer1", transcript: "Alex" });
  ws.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: "answer1", transcript: "Alex" });
  assert.deepEqual(answers, ["Alex"]);
  ws.receive({ type: "response.created", response: { id: "automatic", metadata: null } });
  ws.receive({ type: "response.output_audio_transcript.delta", response_id: "automatic", delta: "Tell me your life story" });
  ws.receive({ type: "response.output_audio.delta", response_id: "automatic", delta: btoa("\0\0") });
  assert.equal(h.contexts[0].sources.length, 0);
  assert.ok(ws.sent.some(e => e.type === "response.cancel" && e.response_id === "automatic"));
  client.speak(onboardingInstructions({ nextField: "seeking", reply: "A person, product, or place?" }));
  ws.receive({ type: "response.created", response: { id: "next", metadata: { app_turn: "3" } } });
  ws.receive({ type: "response.output_audio_transcript.delta", response_id: "initial", delta: "Old question" });
  ws.receive({ type: "response.output_audio_transcript.delta", response_id: "next", delta: "A person, product, or place?" });
  ws.receive({ type: "response.output_audio.delta", response_id: "next", delta: btoa("\0\0") });
  assert.equal(h.contexts[0].sources.length, 1);
  assert.deepEqual(captions, ["What should I call you?", "A person, product, or place?"]);
  client.speak(onboardingInstructions({ nextField: null, reply: "Ready to open the bracket?" }));
  assert.equal(h.contexts[0].sources[0].stopped, true);
  h.sockets[0].serverClose(3000); await tick();
  assert.match(JSON.stringify(h.sockets[1].sent), /interview is complete/);
  assert.match(JSON.stringify(h.sockets[1].sent), /Ready to open the bracket/);
});

test("actual broker response reaches Boson framing, mic PCM and spoken audio/captions", async t => {
  const h = harness(t); const host: string[] = []; const user: string[] = [];
  const client = new RealtimeVoiceSession({ onCaption: text => host.push(text), onUserCaption: text => user.push(text) });
  t.after(() => client.close());
  await client.connect("lobby", h.stream, { instructions: "Be the SpeedMatch host." });
  assert.deepEqual(h.calls, ["/api/session", "/api/realtime/token"]);
  assert.equal(h.sockets[0].url, "wss://api.boson.ai/v1/realtime?model=higgs-realtime");
  assert.deepEqual(h.sockets[0].protocols, ["realtime", "bai-client-secret.bai-eph-test-1"]);
  const config = h.sockets[0].sent[0] as { session: { instructions: string; audio: { input: { transcription: { model: string } } }; output_modalities: string[] } };
  assert.equal(config.session.instructions, "Be the SpeedMatch host.");
  assert.deepEqual(config.session.output_modalities, ["audio"]);
  assert.equal(config.session.audio.input.transcription.model, "higgs-stt-3.1");
  h.worklets[0].port.onmessage?.({ data: new Float32Array(2400).fill(0.25) });
  const append = h.sockets[0].sent.find(event => event.type === "input_audio_buffer.append")!;
  assert.equal(Buffer.from(append.audio as string, "base64").length, 4800);
  h.sockets[0].receive({ type: "response.output_audio.delta", delta: append.audio });
  h.sockets[0].receive({ type: "response.output_audio_transcript.delta", delta: "Hello" });
  h.sockets[0].receive({ type: "conversation.item.input_audio_transcription.completed", transcript: "Hi host" });
  assert.equal(h.contexts[0].sources.length, 1);
  assert.deepEqual(host, ["Hello"]); assert.deepEqual(user, ["Hi host"]);
  h.sockets[0].receive({ type: "input_audio_buffer.speech_started" });
  assert.equal(h.contexts[0].sources[0].stopped, true);
});

test("rejected session bootstrap cannot mint a credential", async t => {
  const h = harness(t, { sessionStatus: 503 });
  const client = new RealtimeVoiceSession(); t.after(() => client.close());
  await assert.rejects(client.connect("lobby", h.stream));
  assert.deepEqual(h.calls, ["/api/session"]);
});

test("audio context is running before reporting a connected voice session", async t => {
  const h = harness(t); const client = new RealtimeVoiceSession(); t.after(() => client.close());
  await client.connect("lobby", h.stream);
  assert.equal(h.contexts[0].state, "running");
});

test("a 3000 close during initial handshake settles connect after bounded recovery", async t => {
  const h = harness(t, { firstClose: 3000 });
  const client = new RealtimeVoiceSession(); t.after(() => client.close());
  const outcome = await Promise.race([client.connect("lobby", h.stream).then(() => "connected", () => "rejected"), new Promise(resolve => setTimeout(() => resolve("hung"), 100))]);
  assert.notEqual(outcome, "hung");
});

test("mid-session expired credentials have a bounded re-mint budget", async t => {
  const h = harness(t); const client = new RealtimeVoiceSession(); t.after(() => client.close());
  await client.connect("lobby", h.stream);
  for (let i=0; i<5; i++) { h.sockets.at(-1)!.serverClose(3000); await tick(); }
  assert.equal(h.mintCount, 4);
  assert.equal(h.contexts[0].state, "closed");
});

test("thirty seconds on one healthy socket restores recovery without allowing a failure burst", async t => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const h = harness(t); const client = new RealtimeVoiceSession(); t.after(() => client.close());
  await client.connect("lobby", h.stream);
  // Three ten-second sockets must not count as one stable thirty-second run.
  for (let i = 0; i < 3; i++) { now += 10_000; h.sockets.at(-1)!.serverClose(3000); await tick(); }
  assert.equal(h.mintCount, 4);
  now += 30_000;
  h.sockets.at(-1)!.serverClose(3000); await tick();
  assert.equal(h.mintCount, 5);
  assert.equal(h.contexts[0].state, "running");
  for (let i = 0; i < 3; i++) { h.sockets.at(-1)!.serverClose(3000); await tick(); }
  assert.equal(h.mintCount, 7);
  assert.equal(h.contexts[0].state, "closed");
});


test("stopping while a token request is pending cannot open a late socket", async t => {
  const h = harness(t);
  let release!: (response: Response) => void;
  let requested!: () => void;
  const requestStarted = new Promise<void>(resolve => { requested = resolve; });
  t.mock.method(globalThis, "fetch", async (input: string) => {
    if (input === "/api/session") return Response.json({ ok: true });
    requested();
    return new Promise<Response>(resolve => { release = resolve; });
  });
  const client = new RealtimeVoiceSession();
  const pending = client.connect("lobby", h.stream);
  await requestStarted;
  client.close();
  release(Response.json({ clientSecret: "bai-eph-test", wsUrl: "wss://api.boson.ai/v1/realtime", subprotocols: ["realtime"] }));
  await assert.rejects(pending);
  assert.equal(h.sockets.length, 0);
  assert.equal(h.contexts[0].state, "closed");
});
