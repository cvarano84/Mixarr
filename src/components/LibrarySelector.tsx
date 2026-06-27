"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { Loader2, Server, Library as LibraryIcon, RefreshCw, CheckCircle2 } from "lucide-react";

export default function LibrarySelector() {
  const [servers, setServers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingServerId, setSyncingServerId] = useState<string | null>(null);
  const [syncingLibraryId, setSyncingLibraryId] = useState<string | null>(null);

  useEffect(() => {
    fetchServers();
  }, []);

  const fetchServers = async () => {
    try {
      const res = await axios.get("/api/plex/servers");
      setServers(res.data.servers || []);
    } catch (error) {
      console.error("Failed to fetch servers", error);
    } finally {
      setLoading(false);
    }
  };

  const syncLibraries = async (serverId: string) => {
    setSyncingServerId(serverId);
    try {
      await axios.post("/api/plex/libraries/sync", { serverId });
      await fetchServers(); // Refresh to show the newly synced libraries
    } catch (error) {
      console.error("Failed to sync libraries", error);
      alert("Failed to sync libraries from this server.");
    } finally {
      setSyncingServerId(null);
    }
  };

  const startFullSync = async (libraryId: string) => {
    setSyncingLibraryId(libraryId);
    try {
      await axios.post("/api/sync/start", { libraryId });
      alert("Background sync started! Check the logs/status.");
    } catch (error) {
      console.error("Failed to start full sync", error);
      alert("Failed to start metadata sync.");
    } finally {
      setSyncingLibraryId(null);
    }
  };

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}><Loader2 className="animate-spin" size={16} /> Loading servers...</div>;
  }

  if (servers.length === 0) {
    return <p style={{ color: 'var(--text-secondary)' }}>No Plex servers found for your account.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {servers.map((server) => (
        <div key={server.id} style={{ background: "var(--bg-surface)", padding: "1.5rem", borderRadius: "var(--radius-lg)", border: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Server size={20} color="var(--accent-blue)" />
              <h3 style={{ fontSize: "1.125rem", margin: 0 }}>{server.name}</h3>
            </div>
            <button
              onClick={() => syncLibraries(server.id)}
              disabled={syncingServerId === server.id}
              style={{
                background: "rgba(59, 130, 246, 0.1)", color: "var(--accent-blue)", border: "none", padding: "0.5rem 1rem", borderRadius: "var(--radius-md)", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", fontWeight: 500
              }}
            >
              {syncingServerId === server.id ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Find Music Libraries
            </button>
          </div>

          {server.libraries && server.libraries.length > 0 ? (
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {server.libraries.map((lib: any) => (
                <div key={lib.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-base)", padding: "1rem", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <LibraryIcon size={18} color="var(--text-secondary)" />
                    <span style={{ fontWeight: 500 }}>{lib.name}</span>
                    <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
                      {(lib._count?.tracks || 0).toLocaleString()} active tracks
                    </span>
                  </div>
                  <button
                    onClick={() => startFullSync(lib.id)}
                    disabled={syncingLibraryId === lib.id}
                    style={{
                      background: "var(--accent-primary)", color: "white", border: "none", padding: "0.5rem 1rem", borderRadius: "var(--radius-md)", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", fontWeight: 600
                    }}
                  >
                    {syncingLibraryId === lib.id ? <Loader2 size={16} className="animate-spin" /> : "Start Metadata Sync"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", margin: 0 }}>No music libraries synced yet. Click 'Find Music Libraries' above.</p>
          )}

          {server.libraries && server.libraries.length > 0 && (
            <div style={{ marginTop: "1.5rem", paddingTop: "1.5rem", borderTop: "1px solid var(--border-subtle)" }}>
              <h4 style={{ fontSize: "1rem", margin: "0 0 1rem 0" }}>Data Enrichment</h4>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                <button
                  onClick={async () => {
                    try {
                      await axios.post("/api/sync/start", { engine: "popularity" });
                      alert("Popularity sync started in the background! Check Docker logs.");
                    } catch(e) {
                      alert("Failed to start popularity sync");
                    }
                  }}
                  style={{
                    background: "var(--bg-base)", border: "1px solid var(--accent-primary)", color: "var(--accent-primary)", padding: "0.5rem 1rem", borderRadius: "var(--radius-md)", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", fontWeight: 600
                  }}
                >
                  Sync Popularity Data (Deezer/Last.fm/Spotify)
                </button>

                <button
                  onClick={async () => {
                    try {
                      await axios.post("/api/sync/start", { engine: "audio" });
                      alert("Audio Features sync started in the background. Processed/skipped/failed counts will appear in Sync Center; check logs for any corrupt track IDs.");
                    } catch(e) {
                      alert("Failed to start audio feature sync");
                    }
                  }}
                  style={{
                    background: "var(--bg-base)", border: "1px solid var(--accent-yellow)", color: "var(--accent-yellow)", padding: "0.5rem 1rem", borderRadius: "var(--radius-md)", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", fontWeight: 600
                  }}
                >
                  Sync Energy & Mood (Spotify)
                </button>
              </div>
              <p style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginTop: "0.75rem" }}>
                These background tasks analyze your 30k+ tracks via external APIs to unlock advanced playlist filtering. They respect strict rate limits.
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
