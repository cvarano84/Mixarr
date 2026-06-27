"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Loader2, Database, Music, Star, Tag, Play, Activity, Info, Sparkles } from "lucide-react";
import { nextStatusPollDelayMs } from "@/lib/statusPolling";

type InitialPromptKind = "metadata" | "enrichment";

const metadataPromptDismissedKey = "mixarr_initial_metadata_sync_prompt_library";
const enrichmentPromptDismissedKey = "mixarr_initial_sync_prompt_fingerprint";
const pendingEnrichmentPromptKey = "mixarr_pending_initial_enrichment_prompt_library";

export default function SyncProgress() {
  const [status, setStatus] = useState<any>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [initialPrompt, setInitialPrompt] = useState<InitialPromptKind | null>(null);
  const [startingInitial, setStartingInitial] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await axios.get("/api/sync/status", { validateStatus: (status) => status < 600 });
      if (res.status === 401) return { ok: false, httpStatus: res.status, data: null };
      setStatus(res.data);
      if (res.data?.poolBusy || res.status === 429 || res.status === 503) {
        return { ok: false, httpStatus: res.status, data: res.data };
      }
      if (res.status >= 400) {
        console.error("Failed to fetch sync status", res.data);
        return { ok: false, httpStatus: res.status, data: res.data };
      }
      return { ok: true, httpStatus: res.status, data: res.data };
    } catch (e) {
      console.error("Failed to fetch sync status", e);
      return { ok: false, data: null };
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let previousDelayMs = 0;
    let failedAttempts = 0;

    const poll = async () => {
      const result = await fetchStatus();
      if (cancelled) return;
      failedAttempts = result.ok ? 0 : failedAttempts + 1;
      previousDelayMs = nextStatusPollDelayMs({
        data: result.data,
        httpStatus: result.httpStatus,
        previousDelayMs,
        failedAttempts,
      });
      timeout = setTimeout(poll, previousDelayMs);
    };

    void poll();

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [fetchStatus]);

  useEffect(() => {
    if (!status) return;

    const totalTracks = status.popularity?.total || 0;
    const initialLibrary = status.metadata?.initialLibrary;
    const libraryFingerprint = status.metadata?.libraryFingerprint || `${initialLibrary?.id || "all"}:${totalTracks}`;
    const dismissedMetadataLibraryId = localStorage.getItem(metadataPromptDismissedKey);
    const dismissedForThisMetadataLibrary = initialLibrary?.id && dismissedMetadataLibraryId === initialLibrary.id;
    const pendingEnrichmentLibraryId = localStorage.getItem(pendingEnrichmentPromptKey);
    const pendingEnrichmentForThisLibrary = initialLibrary?.id && pendingEnrichmentLibraryId === initialLibrary.id;
    const allEnrichmentComplete = [
      status.popularity,
      status.audioFeatures,
      status.bpm,
      status.tags,
    ].every((progress) => progress?.isComplete);

    if (
      status.metadata?.hasEmptyLibrary &&
      initialLibrary?.id &&
      !status.metadata?.isSyncing &&
      !dismissedForThisMetadataLibrary
    ) {
      setInitialPrompt("metadata");
      return;
    }

    if (
      totalTracks > 0 &&
      !status.metadata?.isSyncing &&
      pendingEnrichmentForThisLibrary &&
      !allEnrichmentComplete
    ) {
      setInitialPrompt("enrichment");
      return;
    }

    const enrichmentStarted = [
      status.popularity,
      status.audioFeatures,
      status.bpm,
      status.tags,
    ].some((progress) => {
      if (!progress) return false;
      return (progress.attempted || 0) > 0 || (progress.processed || 0) > 0;
    });

    const dismissedFingerprint = localStorage.getItem(enrichmentPromptDismissedKey);
    const dismissedForThisLibrary = dismissedFingerprint === libraryFingerprint;

    setInitialPrompt(
      totalTracks > 0 &&
        !status.metadata?.isSyncing &&
        !enrichmentStarted &&
        !dismissedForThisLibrary
        ? "enrichment"
        : null,
    );
  }, [status]);

  const startSync = async (engine: string) => {
    setStarting(engine);
    try {
      await axios.post("/api/sync/start", { engine });
      void fetchStatus();
    } catch (e) {
      alert(`Failed to start ${engine} sync`);
    } finally {
      setTimeout(() => setStarting(null), 1000);
    }
  };

  const dismissInitialPrompt = () => {
    if (initialPrompt === "metadata") {
      const libraryId = status?.metadata?.initialLibrary?.id;
      if (libraryId) {
        localStorage.setItem(metadataPromptDismissedKey, libraryId);
      }
      setInitialPrompt(null);
      return;
    }

    const libraryFingerprint = status?.metadata?.libraryFingerprint;
    if (libraryFingerprint) {
      localStorage.setItem(enrichmentPromptDismissedKey, libraryFingerprint);
    }
    localStorage.removeItem(pendingEnrichmentPromptKey);
    setInitialPrompt(null);
  };

  const startInitialSync = async () => {
    setStartingInitial(true);
    try {
      const initialLibrary = status?.metadata?.initialLibrary;
      const isMetadataPrompt = initialPrompt === "metadata";
      const res = await axios.post("/api/sync/start", isMetadataPrompt
        ? { engine: "plex", libraryId: initialLibrary?.id }
        : { engine: "initial" });
      if (isMetadataPrompt && initialLibrary?.id) {
        localStorage.setItem(pendingEnrichmentPromptKey, initialLibrary.id);
      }
      dismissInitialPrompt();
      alert(res.data?.status === "already_running"
        ? res.data.message
        : isMetadataPrompt
          ? `Initial metadata sync started${initialLibrary?.name ? ` for ${initialLibrary.name}` : ""}. Mixarr will import tracks from Plex in the background.`
          : "Initial data sync started. Large libraries can take a while; you can keep using Mixarr while it runs.");
      void fetchStatus();
    } catch (e) {
      console.error("Failed to start initial sync", e);
      alert(initialPrompt === "metadata" ? "Failed to start initial metadata sync." : "Failed to start initial data sync.");
    } finally {
      setStartingInitial(false);
    }
  };

  if (!status) return null;

  if (status.status === "busy") {
    return (
      <div className="glass-panel" style={{ padding: "1.5rem", marginBottom: "2rem", borderRadius: "var(--radius-lg)" }}>
        <h3 style={{ margin: "0 0 0.75rem 0", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Database size={20} color="var(--accent-blue)" />
          Sync Center
        </h3>
        <div style={{ padding: "0.75rem", borderRadius: "var(--radius-md)", background: "rgba(245, 158, 11, 0.1)", color: "var(--accent-yellow)", fontSize: "0.85rem", lineHeight: 1.45 }}>
          {status.warning || "Database connection pool is currently busy. Sync may still be running."}
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: "1.5rem", marginBottom: "2rem", borderRadius: "var(--radius-lg)" }}>
      <h3 style={{ margin: "0 0 1.5rem 0", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Database size={20} color="var(--accent-blue)" />
        Sync Center
      </h3>

      {status.metadata?.corruptTracks > 0 && (
        <div style={{ marginBottom: "1rem", padding: "0.75rem", borderRadius: "var(--radius-md)", background: "rgba(245, 158, 11, 0.1)", color: "var(--accent-yellow)", fontSize: "0.8rem", lineHeight: 1.45 }}>
          {status.metadata.corruptTracks.toLocaleString()} track metadata row(s) were quarantined during enrichment. Clean runs continued; check logs for exact track IDs, then fix the metadata in Plex and run Metadata Sync to repair them.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "1.5rem" }}>
        
        {/* Plex Metadata Sync */}
        <div style={{ background: "var(--bg-base)", padding: "1rem", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}><Database size={16} color="var(--text-secondary)"/> Plex Library</span>
            {status.metadata.isSyncing ? (
              <Loader2 size={16} className="animate-spin" color="var(--accent-blue)" />
            ) : (
              <button onClick={() => alert("Trigger library sync from the library selector below.")} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)" }}>
                <Play size={16} />
              </button>
            )}
          </div>
          <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
            {status.popularity.total.toLocaleString()} Tracks Synced
          </div>
        </div>

        {/* Audio Features Sync */}
        <div style={{ background: "var(--bg-base)", padding: "1rem", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}><Music size={16} color="var(--accent-yellow)"/> Audio Features</span>
            {starting === 'audio' ? <Loader2 size={16} className="animate-spin" /> : (
              <button onClick={() => startSync('audio')} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)" }} title="Start Audio Features Sync">
                <Play size={16} />
              </button>
            )}
          </div>
          <ProgressBar progress={status.audioFeatures} color="linear-gradient(90deg, var(--accent-yellow), #f97316)" />
        </div>

        {/* Popularity Sync */}
        <div style={{ background: "var(--bg-base)", padding: "1rem", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}><Star size={16} color="var(--accent-primary)"/> Popularity Scores</span>
            {starting === 'popularity' ? <Loader2 size={16} className="animate-spin" /> : (
              <button onClick={() => startSync('popularity')} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)" }} title="Start Popularity Sync">
                <Play size={16} />
              </button>
            )}
          </div>
          <ProgressBar progress={status.popularity} color="linear-gradient(90deg, var(--accent-primary), var(--accent-blue))" />
        </div>

        {/* Track Genres Sync */}
        <div style={{ background: "var(--bg-base)", padding: "1rem", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}><Tag size={16} color="#10b981"/> Track Genres</span>
            {starting === 'tags' ? <Loader2 size={16} className="animate-spin" /> : (
              <button onClick={() => startSync('tags')} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)" }} title="Start Genre Sync">
                <Play size={16} />
              </button>
            )}
          </div>
          {status.tags ? (
             <ProgressBar progress={status.tags} color="linear-gradient(90deg, #10b981, #3b82f6)" />
          ) : (
            <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>0% (0 / {status.popularity.total})</div>
          )}
          <div
            title="Track genre enrichment tries Deezer, MusicBrainz, opt-in Discogs/Spotify, then Last.fm as the final fallback."
            style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.25rem" }}
          >
            <Info size={11} /> Uses <code style={{ background: "rgba(255,255,255,0.05)", padding: "0 0.25rem", borderRadius: "3px" }}>Deezer</code>, <code style={{ background: "rgba(255,255,255,0.05)", padding: "0 0.25rem", borderRadius: "3px" }}>MusicBrainz</code>; optional <code style={{ background: "rgba(255,255,255,0.05)", padding: "0 0.25rem", borderRadius: "3px" }}>Discogs/Spotify</code>; <code style={{ background: "rgba(255,255,255,0.05)", padding: "0 0.25rem", borderRadius: "3px" }}>Last.fm</code> fallback
          </div>
        </div>

        {/* BPM Sync */}
        <div style={{ background: "var(--bg-base)", padding: "1rem", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}><Activity size={16} color="#ef4444"/> BPM / Tempo</span>
            {starting === 'bpm' ? <Loader2 size={16} className="animate-spin" /> : (
              <button onClick={() => startSync('bpm')} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)" }} title="Start Local BPM Backfill">
                <Play size={16} />
              </button>
            )}
          </div>
          {status.bpm ? (
             <ProgressBar progress={status.bpm} color="linear-gradient(90deg, #ef4444, var(--accent-yellow))" />
          ) : (
            <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>0% (0 / {status.popularity.total})</div>
          )}
        </div>

      </div>

      {initialPrompt && (
        <div style={modalBackdropStyle}>
          <div style={modalStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
              {initialPrompt === "metadata" ? (
                <Database size={22} color="var(--accent-blue)" />
              ) : (
                <Sparkles size={22} color="var(--accent-primary)" />
              )}
              <h4 style={{ margin: 0, fontSize: "1.125rem" }}>
                {initialPrompt === "metadata" ? "Start initial metadata sync?" : "Start initial data sync?"}
              </h4>
            </div>
            <p style={{ color: "var(--text-secondary)", margin: "0 0 1rem 0", lineHeight: 1.5 }}>
              {initialPrompt === "metadata"
                ? `Mixarr found ${status.metadata?.initialLibrary?.name || "your Plex music library"}${status.metadata?.initialLibrary?.serverName ? ` on ${status.metadata.initialLibrary.serverName}` : ""}, but no tracks are imported yet. Start a metadata sync to index artists, albums, and tracks from Plex.`
                : "Your Plex music library is imported. Mixarr can now enrich it with popularity, genres, audio features, and BPM data. This can take a while on large libraries."}
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: "0 0 1.25rem 0", lineHeight: 1.5 }}>
              {initialPrompt === "metadata"
                ? "After the metadata import finishes, Mixarr can offer the recommended enrichment pass for popularity, genres, audio features, and BPM."
                : "Recommended order: popularity, track genres, audio features, then BPM. BPM runs last so local tempo analysis can improve or fill gaps after the audio feature pass."}
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
              <button onClick={dismissInitialPrompt} disabled={startingInitial} style={secondaryButtonStyle}>
                Maybe later
              </button>
              <button onClick={startInitialSync} disabled={startingInitial} style={primaryButtonStyle}>
                {startingInitial ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : initialPrompt === "metadata" ? (
                  <Database size={16} />
                ) : (
                  <Sparkles size={16} />
                )}
                {initialPrompt === "metadata" ? "Start metadata sync" : "Start recommended sync"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressBar({ progress, color }: { progress: any, color: string }) {
  if (!progress || progress.total === 0) {
    const lastRun = progress?.lastRun;
    return (
      <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
        0% (0 / 0)
        {lastRun?.summary && !lastRun.running && (
          <div style={{ fontSize: "0.7rem", color: lastRun.summary.skipped || lastRun.summary.failed ? "var(--accent-yellow)" : "var(--text-muted)", marginTop: "0.35rem" }}>
            Last run: {lastRun.summary.processed.toLocaleString()} processed, {lastRun.summary.skipped.toLocaleString()} corrupt skipped, {lastRun.summary.failed.toLocaleString()} failed. Check logs for exact track IDs.
          </div>
        )}
      </div>
    );
  }

  const attempted = typeof progress.attempted === "number" ? progress.attempted : undefined;
  const noData = typeof progress.noData === "number"
    ? progress.noData
    : attempted !== undefined
      ? attempted - progress.processed
      : 0;
  const failed = typeof progress.failed === "number" ? progress.failed : undefined;
  const extractionFailed = typeof progress.extractionFailed === "number" ? progress.extractionFailed : undefined;
  const analyzerFailed = typeof progress.analyzerFailed === "number" ? progress.analyzerFailed : undefined;
  const pendingBackfill = typeof progress.pendingBackfill === "number" ? progress.pendingBackfill : undefined;
  const tracksWithBpm = typeof progress.tracksWithBpm === "number" ? progress.tracksWithBpm : undefined;
  const isBpmProgress = tracksWithBpm !== undefined || pendingBackfill !== undefined || failed !== undefined || extractionFailed !== undefined || analyzerFailed !== undefined;
  const isAudioFeatureProgress = typeof progress.complete === "number" || typeof progress.api === "number" || typeof progress.local === "number";
  const showAttempted = attempted !== undefined && noData > 0;
  const lastRun = progress.lastRun;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
        <span>{progress.percentage}%</span>
        <span>{progress.processed.toLocaleString()} / {progress.total.toLocaleString()}</span>
      </div>
      <div style={{ width: "100%", height: "6px", background: "rgba(255,255,255,0.1)", borderRadius: "3px", overflow: "hidden" }}>
        <div 
          style={{ 
            height: "100%", 
            width: `${progress.percentage}%`, 
            background: color,
            transition: "width 0.5s ease-in-out"
          }} 
        />
      </div>
      {isAudioFeatureProgress ? (
        <div
          title="Audio feature status: API values are preferred; local Essentia fills missing fields; heuristic values are marked separately."
          style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.35rem", lineHeight: 1.45 }}
        >
          {(progress.complete ?? progress.processed).toLocaleString()} complete
          {typeof progress.api === "number" ? ` | ${progress.api.toLocaleString()} API` : ""}
          {typeof progress.local === "number" ? ` | ${progress.local.toLocaleString()} local Essentia` : ""}
          {typeof progress.heuristic === "number" && progress.heuristic > 0 ? ` | ${progress.heuristic.toLocaleString()} estimated` : ""}
          {typeof progress.partial === "number" && progress.partial > 0 ? ` | ${progress.partial.toLocaleString()} partial` : ""}
          {typeof progress.noData === "number" && progress.noData > 0 ? ` | ${progress.noData.toLocaleString()} no data` : ""}
          {typeof progress.failed === "number" && progress.failed > 0 ? ` | ${progress.failed.toLocaleString()} failed` : ""}
        </div>
      ) : isBpmProgress ? (
        <div
          title="BPM status: pending tracks are eligible for backfill; no-data, failed, and extraction-failed tracks are intentionally held unless retry is enabled."
          style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.35rem", lineHeight: 1.45 }}
        >
          {(tracksWithBpm ?? progress.processed).toLocaleString()} with BPM
          {attempted !== undefined ? ` | ${attempted.toLocaleString()} attempted` : ""}
          {pendingBackfill !== undefined ? ` | ${pendingBackfill.toLocaleString()} pending` : ""}
          {noData > 0 ? ` | ${noData.toLocaleString()} no data` : ""}
          {failed !== undefined && failed > 0 ? ` | ${failed.toLocaleString()} failed` : ""}
          {extractionFailed !== undefined && extractionFailed > 0 ? ` | ${extractionFailed.toLocaleString()} extraction failed` : ""}
          {analyzerFailed !== undefined && analyzerFailed > 0 ? ` | ${analyzerFailed.toLocaleString()} analyzer failed` : ""}
        </div>
      ) : showAttempted && (
        <div
          title="Attempted includes tracks the engine checked but where no provider returned usable data."
          style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.35rem" }}
        >
          {attempted.toLocaleString()} attempted ({noData.toLocaleString()} no data)
        </div>
      )}
      {lastRun?.summary && !lastRun.running && (
        <div style={{ fontSize: "0.7rem", color: lastRun.summary.skipped || lastRun.summary.failed ? "var(--accent-yellow)" : "var(--text-muted)", marginTop: "0.35rem", lineHeight: 1.45 }}>
          Last run: {lastRun.summary.processed.toLocaleString()} processed, {lastRun.summary.skipped.toLocaleString()} corrupt skipped, {lastRun.summary.failed.toLocaleString()} failed
          {lastRun.summary.skipped > 0 ? ". Check logs for exact track IDs; re-sync or fix the metadata in Plex." : "."}
        </div>
      )}
    </div>
  );
}

const modalBackdropStyle = {
  position: "fixed" as const,
  inset: 0,
  background: "rgba(0,0,0,0.62)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "1rem",
  zIndex: 50,
};

const modalStyle = {
  width: "100%",
  maxWidth: "520px",
  background: "var(--bg-surface)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-lg)",
  padding: "1.25rem",
  boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
};

const primaryButtonStyle = {
  background: "var(--accent-primary)",
  color: "white",
  border: "none",
  padding: "0.65rem 1rem",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  fontSize: "0.875rem",
  fontWeight: 700,
};

const secondaryButtonStyle = {
  background: "var(--bg-base)",
  color: "var(--text-secondary)",
  border: "1px solid var(--border-subtle)",
  padding: "0.65rem 1rem",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontSize: "0.875rem",
  fontWeight: 600,
};
