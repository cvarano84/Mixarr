"use client";

import { useState } from "react";
import axios from "axios";
import { Plus, Trash2, Play, Upload, Star, Music, Shuffle, Activity } from "lucide-react";

type Rule = {
  field: string;
  operator: string;
  value: string;
};

export default function BuilderPage() {
  const [rules, setRules] = useState<Rule[]>([{ field: "popularity", operator: "gt", value: "50" }]);
  const [limit, setLimit] = useState(50);
  const [playlistName, setPlaylistName] = useState("");
  const [tracks, setTracks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const addRule = () => {
    setRules([...rules, { field: "genre", operator: "contains", value: "" }]);
  };

  const removeRule = (index: number) => {
    setRules(rules.filter((_, i) => i !== index));
  };

  const updateRule = (index: number, key: keyof Rule, val: string) => {
    const newRules = [...rules];
    newRules[index][key] = val;
    setRules(newRules);
  };

  const applyTemplate = (templateName: string) => {
    if (templateName === "deep_cuts") {
      setRules([{ field: "popularity", operator: "lt", value: "30" }]);
      setPlaylistName("Deep Cuts Discovered");
    } else if (templateName === "90s") {
      setRules([
        { field: "year", operator: "gte", value: "1990" },
        { field: "year", operator: "lte", value: "1999" }
      ]);
      setPlaylistName("Ultimate 90s Mix");
    } else if (templateName === "christmas") {
      setRules([
        { field: "title", operator: "contains", value: "Christmas" }
      ]);
      setPlaylistName("Christmas Cheer");
    } else if (templateName === "anti_christmas") {
      setRules([
        { field: "title", operator: "not_contains", value: "Christmas" },
        { field: "title", operator: "not_contains", value: "Holiday" }
      ]);
      setPlaylistName("No Holidays Allowed");
    } else if (templateName === "workout") {
      setRules([
        { field: "tempo", operator: "gte", value: "120" },
        { field: "energy", operator: "gte", value: "0.7" }
      ]);
      setPlaylistName("High BPM Workout Mix");
    }
  };

  const previewPlaylist = async () => {
    setLoading(true);
    try {
      const res = await axios.post("/api/playlists/generate", { rules, limit });
      setTracks(res.data.tracks);
    } catch (e) {
      console.error(e);
      alert("Failed to generate preview");
    } finally {
      setLoading(false);
    }
  };

  const exportToPlex = async () => {
    if (!playlistName) {
      alert("Please enter a playlist name");
      return;
    }
    if (tracks.length === 0) {
      alert("Please preview tracks first to ensure the playlist is not empty");
      return;
    }
    setExporting(true);
    try {
      // Step 6 functionality, stubbed for now
      await axios.post("/api/playlists/export", {
        name: playlistName,
        trackIds: tracks.map(t => t.id)
      });
      alert("Playlist exported to Plex successfully!");
    } catch (e) {
      console.error(e);
      alert("Failed to export to Plex");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="builder-container">
      {/* LEFT COLUMN: BUILDER */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2rem" }}>
        <header>
          <h2 style={{ fontSize: "2rem", fontWeight: 700, margin: "0 0 0.5rem 0" }}>Playlist Builder</h2>
          <p style={{ color: "var(--text-secondary)", margin: 0 }}>Create dynamic mixes using cached metadata</p>
        </header>

        {/* Quick Templates */}
        <div className="glass-panel" style={{ padding: "1.5rem", borderRadius: "var(--radius-lg)" }}>
          <h3 style={{ margin: "0 0 1rem 0", fontSize: "1rem" }}>Quick Templates</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            <button onClick={() => applyTemplate("deep_cuts")} style={btnStyle("var(--accent-blue)")}><Shuffle size={14} /> Deep Cuts</button>
            <button onClick={() => applyTemplate("90s")} style={btnStyle("var(--accent-primary)")}><Music size={14} /> 90s Decade</button>
            <button onClick={() => applyTemplate("workout")} style={btnStyle("var(--accent-primary)")}><Activity size={14} /> Workout (High BPM)</button>
            <button onClick={() => applyTemplate("christmas")} style={btnStyle("var(--accent-yellow)")}><Star size={14} /> Seasonal</button>
            <button onClick={() => applyTemplate("anti_christmas")} style={btnStyle("var(--text-muted)")}>Anti-Seasonal</button>
          </div>
        </div>

        {/* Rule Builder */}
        <div className="glass-panel" style={{ padding: "1.5rem", borderRadius: "var(--radius-lg)", flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
            <div>
              <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1rem" }}>Matching Rules</h3>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                <strong>Cheat Sheet:</strong> Happy (Energy: 0.7, Mood: 0.9) | Relaxed (E: 0.2, M: 0.6) | Aggressive (E: 0.9, M: 0.3) | Sad (E: 0.3, M: 0.2)
              </p>
            </div>
            <button onClick={addRule} style={{ background: "none", border: "none", color: "var(--accent-primary)", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.875rem", fontWeight: 500 }}>
              <Plus size={16} /> Add Rule
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "2rem" }}>
            {rules.map((rule, i) => (
              <div key={i} className="rule-row">
                <select
                  value={rule.field}
                  onChange={(e) => updateRule(i, "field", e.target.value)}
                  style={inputStyle}
                >
                  <option value="popularity">Popularity Score (0-100)</option>
                  <option value="energy">Energy (0.0-1.0)</option>
                  <option value="valence">Mood/Valence (0.0-1.0)</option>
                  <option value="tempo">BPM (Beats Per Minute) / Tempo</option>
                  <option value="year">Release Year</option>
                  <option value="genre">Genre Tag</option>
                  <option value="artist">Artist Name</option>
                  <option value="title">Track Title</option>
                </select>

                <select
                  value={rule.operator}
                  onChange={(e) => updateRule(i, "operator", e.target.value)}
                  style={inputStyle}
                >
                  <option value="eq">Equals (=)</option>
                  <option value="contains">Contains</option>
                  <option value="not_contains">Does Not Contain</option>
                  <option value="gt">Greater Than (&gt;)</option>
                  <option value="lt">Less Than (&lt;)</option>
                  <option value="gte">Greater or Equal (&ge;)</option>
                  <option value="lte">Less or Equal (&le;)</option>
                </select>

                <input
                  type="text"
                  value={rule.value}
                  onChange={(e) => updateRule(i, "value", e.target.value)}
                  placeholder="Value..."
                  style={{ ...inputStyle, flex: 1 }}
                />

                <button onClick={() => removeRule(i)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "0.5rem" }}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem", borderTop: "1px solid var(--border-subtle)", paddingTop: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <label style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>Track Limit:</label>
              <input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ ...inputStyle, width: "80px" }} />
            </div>
            <button onClick={previewPlaylist} disabled={loading} style={{ background: "var(--accent-primary)", color: "white", border: "none", padding: "0.75rem 1.5rem", borderRadius: "var(--radius-md)", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600, marginLeft: "auto" }}>
              <Play size={16} /> {loading ? "Querying..." : "Preview Playlist"}
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: PREVIEW */}
      <div className="glass-panel" style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1rem", padding: "1.5rem", borderRadius: "var(--radius-lg)" }}>
        <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.25rem" }}>Playlist Preview</h3>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <input
            type="text"
            placeholder="Name your playlist..."
            value={playlistName}
            onChange={(e) => setPlaylistName(e.target.value)}
            style={{ ...inputStyle, flex: 1, fontSize: "1rem", padding: "0.75rem" }}
          />
          <button onClick={exportToPlex} disabled={exporting || tracks.length === 0} style={{ background: "var(--accent-blue)", color: "white", border: "none", padding: "0.75rem 1.5rem", borderRadius: "var(--radius-md)", cursor: (exporting || tracks.length === 0) ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600, opacity: (exporting || tracks.length === 0) ? 0.5 : 1 }}>
            <Upload size={16} /> {exporting ? "Pushing..." : "Push to Plex"}
          </button>
        </div>

        <div className="table-container">
          {tracks.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: "0.875rem" }}>
              Click Preview Playlist to see results
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)", backgroundColor: "var(--bg-surface)", position: "sticky", top: 0 }}>
                  <th style={{ padding: "0.75rem 1rem", color: "var(--text-secondary)", fontWeight: 600, fontSize: "0.75rem", width: "40px" }}>#</th>
                  <th style={{ padding: "0.75rem 1rem", color: "var(--text-secondary)", fontWeight: 600, fontSize: "0.75rem" }}>Track</th>
                  <th style={{ padding: "0.75rem 1rem", color: "var(--text-secondary)", fontWeight: 600, fontSize: "0.75rem" }}>Artist</th>
                  <th style={{ padding: "0.75rem 1rem", color: "var(--text-secondary)", fontWeight: 600, fontSize: "0.75rem", width: "60px" }}>BPM</th>
                  <th style={{ padding: "0.75rem 1rem", color: "var(--text-secondary)", fontWeight: 600, fontSize: "0.75rem", width: "60px" }}>Pop</th>
                </tr>
              </thead>
              <tbody>
                {tracks.map((track, idx) => (
                  <tr key={track.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", fontSize: "0.875rem" }}>{idx + 1}</td>
                    <td style={{ padding: "0.75rem 1rem", fontWeight: 500, fontSize: "0.875rem" }}>{track.title}</td>
                    <td style={{ padding: "0.75rem 1rem", color: "var(--text-secondary)", fontSize: "0.875rem" }}>{track.artist?.title}</td>
                    <td style={{ padding: "0.75rem 1rem", color: "var(--accent-primary)", fontSize: "0.875rem", fontWeight: 600 }}>{track.audioFeature?.tempo?.toFixed(0) || "-"}</td>
                    <td style={{ padding: "0.75rem 1rem", color: "var(--accent-yellow)", fontSize: "0.875rem", fontWeight: 600 }}>{track.popularity?.score?.toFixed(0) || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div style={{ textAlign: "right", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
          {tracks.length} tracks matched
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  background: "var(--bg-base)",
  border: "1px solid var(--border-subtle)",
  color: "var(--text-primary)",
  padding: "0.5rem 0.75rem",
  borderRadius: "var(--radius-sm)",
  fontSize: "0.875rem",
  outline: "none"
};

const btnStyle = (color: string) => ({
  background: `rgba(255,255,255,0.05)`,
  border: `1px solid ${color}`,
  color: color,
  padding: "0.4rem 0.75rem",
  borderRadius: "var(--radius-full)",
  cursor: "pointer",
  fontSize: "0.75rem",
  fontWeight: 600,
  display: "flex",
  alignItems: "center",
  gap: "0.25rem",
});
