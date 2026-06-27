"use client";

import { useState } from "react";
import axios from "axios";
import { Ban, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";

export default function BlockTrackButton({
  trackId,
  initialBlocked = false,
  onBlocked,
}: {
  trackId: string;
  initialBlocked?: boolean;
  onBlocked?: (trackId: string) => void;
}) {
  const router = useRouter();
  const [blocked, setBlocked] = useState(initialBlocked);
  const [saving, setSaving] = useState(false);

  const toggleBlocked = async () => {
    setSaving(true);
    try {
      if (blocked) {
        await axios.delete(`/api/tracks/${trackId}/block`);
        setBlocked(false);
      } else {
        await axios.post(`/api/tracks/${trackId}/block`);
        setBlocked(true);
        onBlocked?.(trackId);
      }
      router.refresh();
    } catch (error) {
      console.error("Failed to update blocked track", error);
      alert("Could not update blocked track");
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      title={blocked ? "Allow this track in generated playlists" : "Block from generated playlists"}
      aria-label={blocked ? "Allow this track in generated playlists" : "Block from generated playlists"}
      onClick={toggleBlocked}
      disabled={saving}
      style={{
        ...blockButtonStyle,
        color: blocked ? "var(--accent-yellow)" : "var(--text-secondary)",
        opacity: saving ? 0.65 : 1,
      }}
    >
      {blocked ? <RotateCcw size={14} /> : <Ban size={14} />}
      <span>{blocked ? "Blocked" : "Block"}</span>
    </button>
  );
}

const blockButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.35rem",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-sm)",
  padding: "0.35rem 0.55rem",
  cursor: "pointer",
  fontSize: "0.72rem",
  fontWeight: 700,
};
