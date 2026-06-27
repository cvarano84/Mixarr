"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { CheckCircle2, Loader2 } from "lucide-react";

export default function LibraryDefaultSelector() {
  const [servers, setServers] = useState<any[]>([]);
  const [serverId, setServerId] = useState("");
  const [libraryId, setLibraryId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSelection();
  }, []);

  const libraries = useMemo(() => {
    return servers.find(server => server.id === serverId)?.libraries || [];
  }, [servers, serverId]);

  const fetchSelection = async () => {
    try {
      const res = await axios.get("/api/settings/library-selection");
      setServers(res.data.servers || []);
      setServerId(res.data.defaultServerId || "");
      setLibraryId(res.data.defaultLibraryId || "");
    } finally {
      setLoading(false);
    }
  };

  const saveSelection = async () => {
    setSaving(true);
    try {
      await axios.put("/api/settings/library-selection", { serverId, libraryId });
    } finally {
      setSaving(false);
    }
  };

  const onServerChange = (nextServerId: string) => {
    const nextServer = servers.find(server => server.id === nextServerId);
    setServerId(nextServerId);
    setLibraryId(nextServer?.libraries?.[0]?.id || "");
  };

  if (loading) {
    return <div style={{ color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "0.5rem" }}><Loader2 size={16} className="animate-spin" /> Loading libraries...</div>;
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div>
        <label style={labelStyle}>Default Plex Server</label>
        <select value={serverId} onChange={(e) => onServerChange(e.target.value)} style={inputStyle}>
          <option value="">All servers</option>
          {servers.map(server => (
            <option key={server.id} value={server.id}>{server.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Default Music Library</label>
        <select value={libraryId} onChange={(e) => setLibraryId(e.target.value)} style={inputStyle}>
          <option value="">All music libraries</option>
          {libraries.map((library: any) => (
            <option key={library.id} value={library.id}>{library.name}</option>
          ))}
        </select>
      </div>
      <button onClick={saveSelection} disabled={saving} style={buttonStyle}>
        {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
        Save Default Library
      </button>
    </div>
  );
}

const labelStyle = {
  display: "block",
  fontSize: "0.875rem",
  color: "var(--text-secondary)",
  marginBottom: "0.25rem",
};

const inputStyle = {
  background: "rgba(0,0,0,0.2)",
  border: "1px solid var(--border-subtle)",
  color: "var(--text-primary)",
  padding: "0.75rem",
  borderRadius: "var(--radius-sm)",
  fontSize: "0.875rem",
  width: "100%",
  outline: "none",
};

const buttonStyle = {
  background: "var(--accent-primary)",
  border: "none",
  color: "white",
  padding: "0.75rem 1rem",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontSize: "0.875rem",
  fontWeight: 600,
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  justifyContent: "center",
};
