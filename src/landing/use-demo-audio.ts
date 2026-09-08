import { useEffect, useRef, useState } from "react";
import voiceUrl from "../../docs/media/landing-voice.wav?url";
import spans from "./demo-spans.json";

export function useDemoAudio(cutKey: string, suspended: boolean) {
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState("");
  const context = useRef<AudioContext | null>(null);
  const decoded = useRef<AudioBuffer | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const generation = useRef(0);
  const offset = useRef(0);
  const started = useRef(0);
  const frame = useRef(0);
  function stop(reset = false) {
    generation.current++;
    if (source.current && context.current) offset.current += context.current.currentTime - started.current;
    if (source.current) { source.current.onended = null; source.current.stop(); source.current = null; }
    cancelAnimationFrame(frame.current);
    if (reset) offset.current = 0;
    setPosition(offset.current);
    setPlaying(false);
  }
  useEffect(() => { stop(true); }, [cutKey, suspended]);
  useEffect(() => {
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hide);
    return () => { document.removeEventListener("visibilitychange", hide); stop(true); void context.current?.close(); context.current = null; decoded.current = null; };
  }, []);
  async function toggle() {
    if (playing) { stop(); return; }
    if (suspended) return;
    const token = ++generation.current;
    setError("");
    setPlaying(true);
    try {
      const ctx = context.current ??= new AudioContext();
      await ctx.resume();
      if (!decoded.current) {
        const response = await fetch(voiceUrl);
        if (!response.ok) throw new Error("Audio unavailable");
        const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        if (token !== generation.current) return;
        decoded.current = buffer;
      }
      if (token !== generation.current) return;
      const original = decoded.current;
      let cursor = 0;
      const chunks = spans.map((span, i) => {
        const end = cursor + Math.round(span.duration * original.sampleRate);
        const chunk = original.getChannelData(0).slice(cursor, end);
        cursor = end;
        return cutKey[i] === "1" ? new Float32Array(0) : chunk;
      });
      const edited = ctx.createBuffer(1, chunks.reduce((sum, c) => sum + c.length, 0), original.sampleRate);
      let at = 0;
      for (const chunk of chunks) { edited.copyToChannel(chunk, 0, at); at += chunk.length; }
      if (offset.current >= edited.duration) offset.current = 0;
      const node = ctx.createBufferSource();
      node.buffer = edited;
      node.connect(ctx.destination);
      source.current = node;
      started.current = ctx.currentTime;
      node.onended = () => { source.current = null; offset.current = 0; setPosition(0); setPlaying(false); cancelAnimationFrame(frame.current); };
      node.start(0, offset.current);
      const tick = () => {
        setPosition(Math.min(edited.duration, offset.current + ctx.currentTime - started.current));
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    } catch {
      if (token !== generation.current) return;
      stop();
      setError("Audio could not load. Please press play to try again.");
    }
  }
  return { playing, position, error, toggle, resetAudio: () => stop(true) };
}
