"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Loader2 } from "lucide-react";

/**
 * High-level UX states for the Plex login flow. We track these instead of
 * the previous boolean+enum combo so the button can show a meaningful
 * status string ("Waiting for Plex authorization...", "Setting up your
 * account...") at every stage rather than going dark the moment the
 * popup closes.
 */
type Phase =
  | "idle"
  | "awaiting-plex" // popup is open; user is interacting with Plex
  | "finalizing"    // popup is closed; backend is still finishing user/server discovery
  | "success"
  | "error";

// Plex PINs expire after ~30 minutes. We bail considerably earlier so a
// user who closes the popup without authorizing doesn't see an infinite
// spinner.
const MAX_LOGIN_MS = 5 * 60 * 1000;

// After the popup closes, give the backend this much extra time to
// finish (PIN check + user upsert + parallel server discovery should
// complete in well under 5 seconds; anything beyond this is almost
// certainly the user having cancelled).
const FINALIZE_GRACE_MS = 30 * 1000;

const POLL_INTERVAL_MS = 2000;

export default function PlexLoginButton() {
  const [phase, setPhase] = useState<Phase>("idle");

  // Mirror `phase` into a ref so timer callbacks always see the latest
  // value. The previous implementation captured `status` in a closure at
  // the moment setInterval was created, which meant that when the popup
  // closed the "if (status !== 'success')" branch always ran with the
  // stale "polling" value and reset the UI to idle - even if the user
  // had actually authenticated. That's the root cause of "I had to log
  // in several times before it stuck".
  const phaseRef = useRef<Phase>("idle");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const startLoginFlow = async () => {
    try {
      setPhase("awaiting-plex");

      // 1. Request a PIN
      const pinRes = await axios.get("/api/auth/plex/pin");
      const { pinId, authUrl } = pinRes.data;

      // 2. Open Plex auth in a popup window
      const popup = window.open(authUrl, "PlexLogin", "width=600,height=700");

      if (!popup) {
        alert("Please allow popups for this site to log in with Plex.");
        setPhase("idle");
        return;
      }

      const loginStart = Date.now();
      let popupClosedAt: number | null = null;
      let pollInFlight = false;

      // 3. Poll the backend to check whether the PIN has been
      //    authenticated (and to drive the post-auth server discovery).
      //    The setInterval is declared first so `finish` can clear it,
      //    but `finish` is only ever *called* from inside the timer
      //    callbacks - by which point the variable exists.
      const finish = (next: Phase) => {
        clearInterval(pollInterval);
        clearInterval(popupWatcher);
        if (!popup.closed) popup.close();
        setPhase(next);
        if (next === "success") {
          // Reload so the server-rendered layout picks up the new
          // session cookie and the dashboard renders the logged-in view.
          window.location.reload();
        }
      };

      const pollInterval = setInterval(async () => {
        // Guard against piling up overlapping requests. With the old
        // 2-second interval and 20+ second discovery calls, the user
        // could end up with a dozen concurrent /poll requests all
        // independently doing the same server discovery. The backend is
        // now much faster but we still don't want to ever stack them.
        if (pollInFlight) return;

        if (Date.now() - loginStart > MAX_LOGIN_MS) {
          console.warn("Plex login timed out; giving up.");
          finish("error");
          return;
        }

        if (popupClosedAt && Date.now() - popupClosedAt > FINALIZE_GRACE_MS) {
          // Popup was closed and the backend hasn't returned success
          // within the grace window. Most likely the user closed Plex
          // without authorizing.
          console.warn("Plex login: popup closed without successful auth.");
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

      // 4. Watch for the popup closing. Plex doesn't auto-close the
      //    window on success, so the user typically closes it themselves
      //    after seeing the "you can close this tab" confirmation. We
      //    can't tell from the front-end whether that close meant
      //    "I authorized" or "I cancelled", so we keep polling either
      //    way - but we flip the button label to "Setting up your
      //    account..." so the user knows something is still happening
      //    after they dismiss the Plex window.
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
      ? "Waiting for Plex authorization\u2026"
      : phase === "finalizing"
      ? "Setting up your account\u2026"
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
        gap: "0.5rem",
      }}
    >
      {isWorking && <Loader2 size={14} className="animate-spin" />}
      {label}
    </button>
  );
}
