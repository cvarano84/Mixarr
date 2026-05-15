"use client";

import { useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

let activeAudio: HTMLAudioElement | null = null;
let activeStop: (() => void) | null = null;

export default function TrackPreviewButton({ trackId }: { trackId: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const stop = (showFailed = false) => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setPlaying(false);
    setLoading(false);
    if (showFailed) {
      setFailed(true);
      window.setTimeout(() => setFailed(false), 2000);
    }
  };

  const play = async () => {
    if (activeAudio && activeAudio !== audioRef.current) {
      activeStop?.();
    }

    if (!audioRef.current) {
      audioRef.current = new Audio(`/api/tracks/${trackId}/preview`);
      audioRef.current.preload = "none";
      audioRef.current.addEventListener("ended", () => stop());
      audioRef.current.addEventListener("error", () => stop(true));
    }

    setFailed(false);
    setLoading(true);
    activeAudio = audioRef.current;
    activeStop = stop;

    try {
      await audioRef.current.play();
      setPlaying(true);
      setLoading(false);
      timerRef.current = window.setTimeout(stop, 30000);
    } catch {
      stop(true);
    }
  };

  return (
    <button
      type="button"
      title={failed ? "Preview unavailable" : playing ? "Stop preview" : "Play 30 second preview"}
      aria-label={failed ? "Preview unavailable" : playing ? "Stop preview" : "Play 30 second preview"}
      onClick={() => playing ? stop() : play()}
      style={previewButtonStyle}
    >
      {playing ? <Pause size={14} /> : <Play size={14} />}
      <span>{failed ? "Unavailable" : loading ? "Loading" : playing ? "Stop" : "Preview"}</span>
    </button>
  );
}

const previewButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.35rem",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid var(--border-subtle)",
  color: "var(--text-secondary)",
  borderRadius: "var(--radius-sm)",
  padding: "0.35rem 0.55rem",
  cursor: "pointer",
  fontSize: "0.72rem",
  fontWeight: 700,
};
