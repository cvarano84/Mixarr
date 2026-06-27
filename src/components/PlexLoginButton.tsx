"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Loader2 } from "lucide-react";

type Phase = "idle" | "awaiting-plex" | "finalizing" | "success" | "error";

const MAX_LOGIN_MS = 5 * 60 * 1000;
const FINALIZE_GRACE_MS = 30 * 1000;
const POLL_INTERVAL_MS = 2000;

export default function PlexLoginButton() {
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const startLoginFlow = async () => {
    try {
      setPhase("awaiting-plex");
      
      // 1. Request a PIN
      const res = await axios.get("/api/auth/plex/pin");
      const { pinId, authUrl } = res.data;

      // 2. Open Plex Auth in a popup window
      const popup = window.open(authUrl, "PlexLogin", "width=600,height=700");

      if (!popup) {
        alert("Please allow popups for this site to log in with Plex.");
        setPhase("idle");
        return;
      }

      const loginStart = Date.now();
      let popupClosedAt: number | null = null;
      let pollInFlight = false;

      const finish = (next: Phase) => {
        clearInterval(pollInterval);
        clearInterval(popupWatcher);
        if (!popup.closed) popup.close();
        setPhase(next);
        if (next === "success") {
          window.location.reload();
        }
      };

      // 3. Poll the backend to check if the PIN has been authenticated
      const pollInterval = setInterval(async () => {
        if (pollInFlight) return;

        if (Date.now() - loginStart > MAX_LOGIN_MS) {
          console.warn("Plex login timed out.");
          finish("error");
          return;
        }

        if (popupClosedAt && Date.now() - popupClosedAt > FINALIZE_GRACE_MS) {
          console.warn("Plex login popup closed before authorization completed.");
          finish("idle");
          return;
        }

        pollInFlight = true;
        try {
          const pollRes = await axios.post("/api/auth/plex/poll", { pinId });
          
          if (pollRes.data.status === "success") {
            finish("success");
          }
        } catch (pollError) {
          console.error("Polling error:", pollError);
          finish("error");
        } finally {
          pollInFlight = false;
        }
      }, POLL_INTERVAL_MS);

      const popupWatcher = setInterval(() => {
        if (popup.closed && phaseRef.current === "awaiting-plex") {
          popupClosedAt = Date.now();
          setPhase("finalizing");
        }
      }, 500);

    } catch (err) {
      console.error("Failed to start login flow", err);
      setPhase("error");
    }
  };

  if (phase === "success") {
    return <span style={{ color: "#10b981", fontSize: "0.875rem" }}>Authenticated!</span>;
  }

  const isWorking = phase === "awaiting-plex" || phase === "finalizing";
  const label =
    phase === "awaiting-plex"
      ? "Waiting for Plex authorization..."
      : phase === "finalizing"
      ? "Setting up your account..."
      : phase === "error"
      ? "Login failed - try again"
      : "Login to Plex \u2192";

  return (
    <button 
      onClick={startLoginFlow} 
      disabled={isWorking}
      style={{
        background: "none",
        border: "none",
        color: phase === "error" ? "#ef4444" : "var(--accent-primary)",
        fontWeight: 600,
        fontSize: "0.875rem",
        cursor: isWorking ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        gap: "0.5rem"
      }}
    >
      {isWorking && <Loader2 size={14} className="animate-spin" />}
      {label}
    </button>
  );
}
