"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { Loader2, Database, Music, Star, Tag, Play, Activity } from "lucide-react";

export default function SyncProgress() {
  const [status, setStatus] = useState<any>(null);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    fetchStatus();
    // Poll every 5 seconds
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await axios.get("/api/sync/status");
      setStatus(res.data);
    } catch (e) {
      console.error("Failed to fetch sync status", e);
    }
  };

  const startSync = async (engine: string) => {
    setStarting(engine);
    try {
      await axios.post("/api/sync/start", { engine });
      fetchStatus();
    } catch (e) {
      alert(`Failed to start ${engine} sync`);
    } finally {
      setTimeout(() => setStarting(null), 1000);
    }
  };

  if (!status) return null;

  return (
    <div className="glass-panel" style={{ padding: "1.5rem", marginBottom: "2rem", borderRadius: "var(--radius-lg)" }}>
      <h3 style={{ margin: "0 0 1.5rem 0", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Database size={20} color="var(--accent-blue)" />
        Sync Center
      </h3>

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
        </div>

        {/* BPM Sync */}
        <div style={{ background: "var(--bg-base)", padding: "1rem", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}><Activity size={16} color="#ef4444"/> BPM / Tempo</span>
            {starting === 'audio' ? <Loader2 size={16} className="animate-spin" /> : (
              <button onClick={() => startSync('audio')} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)" }} title="Start Audio Features Sync">
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
    </div>
  );
}

function ProgressBar({ progress, color }: { progress: any, color: string }) {
  if (!progress || progress.total === 0) {
    return <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>0% (0 / 0)</div>;
  }

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
    </div>
  );
}
