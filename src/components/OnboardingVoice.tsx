"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RealtimeVoiceSession, type RealtimeStatus } from "../lib/realtime";
import { onboardingInstructions, type OnboardingCue } from "../lib/onboardingVoice";

type Props = {
  onTurn: (id: string, who: "host" | "you", text: string) => void;
  onActive: (active: boolean) => void;
  onAnswer: (text: string) => void;
  cue: OnboardingCue | null;
};
const LABEL: Record<RealtimeStatus, string> = {
  connecting: "Connecting…", connected: "Ready for your answer", listening: "Listening",
  speaking: "Speaking", closed: "Microphone off", error: "Connection interrupted",
};

export default function OnboardingVoice({ onTurn, onActive, onAnswer, cue }: Props) {
  const [status, setStatus] = useState<RealtimeStatus>("closed");
  const [active, setActive] = useState(false);
  const [camera, setCamera] = useState(false);
  const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const session = useRef<RealtimeVoiceSession | null>(null);
  const generation = useRef(0);
  const starting = useRef(false);
  const callbacks = useRef({ onTurn, onActive, onAnswer, cue });
  useEffect(() => { callbacks.current = { onTurn, onActive, onAnswer, cue }; }, [onTurn, onActive, onAnswer, cue]);
  useEffect(() => {
    if (cue && session.current && !starting.current) session.current.speak(onboardingInstructions(cue));
  }, [cue]);

  const release = useCallback(() => {
    generation.current++;
    starting.current = false;
    session.current?.close(); session.current = null;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);
  useEffect(() => release, [release]);
  const stop = () => {
    release(); setActive(false); setStatus("closed"); callbacks.current.onActive(false);
  };

  const start = async () => {
    if (starting.current || session.current || !callbacks.current.cue) return;
    starting.current = true;
    const run = ++generation.current;
    setActive(true); setStatus("connecting"); setError(""); callbacks.current.onActive(true);
    let hostId = ""; let hostText = "";
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone unavailable");
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }, video: camera,
      });
      if (run !== generation.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      if (video.current) video.current.srcObject = media;
      const connection = new RealtimeVoiceSession({
        onStatus: next => {
          if (run !== generation.current) return;
          setStatus(next);
          if (next === "closed" || next === "error") {
            release(); setActive(false); callbacks.current.onActive(false);
            setError("Voice disconnected. Start again to reconnect.");
          }
        },
        onError: () => {
          if (run !== generation.current) return;
          release(); setActive(false); setStatus("error"); callbacks.current.onActive(false);
          setError("Voice couldn’t connect. Please try again in a moment.");
        },
        onCaption: (delta, done) => {
          if (run !== generation.current) return;
          if (done) { hostId = ""; hostText = ""; return; }
          if (!hostId) hostId = callbacks.current.cue?.id ?? crypto.randomUUID();
          hostText = (hostText + delta).slice(-2000);
          callbacks.current.onTurn(hostId, "host", hostText);
        },
        onUserCaption: (text, done) => {
          if (run === generation.current && done && text.trim()) {
            callbacks.current.onAnswer(text.slice(0, 2000));
          }
        },
      });
      session.current = connection;
      await connection.connect("lobby", media, {
        instructions: onboardingInstructions(callbacks.current.cue!),
        controlledResponses: true,
      });
    } catch (err) {
      if (run !== generation.current) return;
      release(); setActive(false); setStatus("error"); callbacks.current.onActive(false);
      setError(err instanceof DOMException && err.name === "NotAllowedError"
        ? "Allow microphone access, then try again. Camera access is only needed in video mode."
        : err instanceof DOMException && err.name === "NotFoundError"
          ? "Device not found. Try microphone-only mode or connect a microphone."
          : "Voice couldn’t connect. Please try again in a moment.");
    } finally { if (run === generation.current) starting.current = false; }
  };

  return <section aria-label="Voice and video" className="mb-6">
    <div className="grid grid-cols-2 gap-3 sm:gap-5">
      <div className={`flex min-h-44 flex-col items-center justify-center rounded-2xl border bg-gradient-to-br from-brand-purple/20 to-brand-pink/10 p-4 ${status === "speaking" ? "border-brand-pink shadow-lg shadow-brand-pink/15" : "border-card-border"}`}>
        {/* Audio-reactive host illustration; not a generated avatar-video stream. */}
        <svg viewBox="0 0 100 100" className="h-24 w-24" role="img" aria-label="SpeedMatch host illustration">
          <circle cx="50" cy="50" r="47" fill="#231330" />
          <rect x="24" y="22" width="52" height="59" rx="24" fill="#b08aff" />
          <circle cx="39" cy="47" r="4" fill="#160e22" /><circle cx="61" cy="47" r="4" fill="#160e22" />
          <rect x="38" y="62" width="24" height={status === "speaking" ? 12 : 4} rx="4" fill="#160e22" />
          <path d="M21 54V43a29 29 0 0 1 58 0v11" fill="none" stroke="#ff5da2" strokeWidth="5" />
        </svg>
        <p className="mt-2 text-sm font-semibold">Your host</p>
        <p className="mt-1 text-xs text-muted">{status === "speaking" ? "Speaking with Boson" : "Boson voice"}</p>
      </div>
      <div className="relative flex min-h-44 flex-col items-center justify-center overflow-hidden rounded-2xl border border-card-border bg-card p-4">
        <video ref={video} autoPlay muted playsInline aria-label="Your local webcam preview" className={`absolute inset-0 h-full w-full object-cover ${camera && active ? "" : "hidden"}`} />
        {!(camera && active) && <><span aria-hidden="true" className="text-4xl">{camera ? "📷" : "🎤"}</span><p className="mt-3 text-sm text-muted">{camera ? "Your camera preview" : "Microphone only"}</p></>}
        <span className={`absolute bottom-3 left-3 rounded-full px-3 py-1 text-xs ${camera && active ? "bg-black/60 text-white" : "bg-background text-muted"}`}>You · {camera ? "camera + mic" : "mic"}</span>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
      <button type="button" disabled={!cue && !active} onClick={active ? stop : () => void start()} className="rounded-full bg-gradient-to-r from-brand-pink to-brand-purple px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{active ? "Stop microphone" : "Start talking"}</button>
      <button type="button" disabled={active} aria-pressed={camera} onClick={() => setCamera(value => !value)} className="rounded-full border border-card-border bg-card px-4 py-2.5 text-sm disabled:opacity-50">{camera ? "📷 Camera + mic" : "🎤 Mic only"}</button>
      <span role="status" className="text-xs text-muted">{status === "connected" && cue?.nextField === null ? "Interview complete" : LABEL[status]}</span>
    </div>
    {error && <p role="alert" className="mt-3 text-center text-sm text-brand-pink">{error}</p>}
    <p className="mt-3 text-center text-xs text-muted">Camera preview stays on this device. While connected, your microphone audio goes to Boson for the conversation.</p>
  </section>;
}
