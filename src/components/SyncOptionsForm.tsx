"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { CheckCircle2, Loader2, RotateCcw, SlidersHorizontal } from "lucide-react";

type SyncOptionKey =
  | "plexPageSize"
  | "popularityBatchSize"
  | "audioFeatureBatchSize"
  | "tagBatchSize"
  | "bpmBatchSize"
  | "providerDelayMs";

type FormState = Record<SyncOptionKey, string>;

const emptyState: FormState = {
  plexPageSize: "",
  popularityBatchSize: "",
  audioFeatureBatchSize: "",
  tagBatchSize: "",
  bpmBatchSize: "",
  providerDelayMs: "",
};

const fields: Array<{
  key: SyncOptionKey;
  label: string;
  hint: string;
  placeholder: string;
}> = [
  {
    key: "plexPageSize",
    label: "Plex metadata page size",
    hint: "Blank asks Plex for the full metadata list in one pass.",
    placeholder: "No page limit",
  },
  {
    key: "popularityBatchSize",
    label: "Popularity tracks per run",
    hint: "Blank processes every track still missing popularity.",
    placeholder: "All missing tracks",
  },
  {
    key: "audioFeatureBatchSize",
    label: "Audio feature tracks per run",
    hint: "Blank processes every track still missing mood or feature data.",
    placeholder: "All missing tracks",
  },
  {
    key: "tagBatchSize",
    label: "Genre tag tracks per run",
    hint: "Blank processes every track that has not been tag-scanned.",
    placeholder: "All untagged tracks",
  },
  {
    key: "bpmBatchSize",
    label: "Local BPM tracks per run",
    hint: "Blank analyzes every track missing a confident BPM.",
    placeholder: "All missing BPM",
  },
  {
    key: "providerDelayMs",
    label: "Provider delay in milliseconds",
    hint: "Blank keeps the app's safe rate-limit pause; 0 removes the pause.",
    placeholder: "Default pause",
  },
];

export default function SyncOptionsForm() {
  const [form, setForm] = useState<FormState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await axios.get("/api/settings/sync-options");
      const nextState = { ...emptyState };
      fields.forEach(({ key }) => {
        const value = res.data?.[key];
        nextState[key] = value === null || value === undefined ? "" : String(value);
      });
      setForm(nextState);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const payload = Object.fromEntries(
        fields.map(({ key }) => [key, form[key] === "" ? null : Number(form[key])])
      );
      const res = await axios.put("/api/settings/sync-options", payload);
      const nextState = { ...emptyState };
      fields.forEach(({ key }) => {
        const value = res.data?.[key];
        nextState[key] = value === null || value === undefined ? "" : String(value);
      });
      setForm(nextState);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } finally {
      setSaving(false);
    }
  };

  const clearLimits = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await axios.put("/api/settings/sync-options", emptyState);
      const nextState = { ...emptyState };
      fields.forEach(({ key }) => {
        const value = res.data?.[key];
        nextState[key] = value === null || value === undefined ? "" : String(value);
      });
      setForm(nextState);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Loader2 size={16} className="animate-spin" /> Loading sync options...
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        {fields.map((field) => (
          <label key={field.key} style={{ display: "grid", gap: "0.35rem" }}>
            <span style={labelStyle}>{field.label}</span>
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={form[field.key]}
              placeholder={field.placeholder}
              onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
              style={inputStyle}
            />
            <span style={hintStyle}>{field.hint}</span>
          </label>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
        <button onClick={saveSettings} disabled={saving} style={buttonStyle}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          {saved ? "Saved" : "Save Sync Options"}
        </button>
        <button onClick={clearLimits} disabled={saving} style={secondaryButtonStyle}>
          <RotateCcw size={16} />
          Clear Limits
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-muted)", fontSize: "0.8rem" }}>
        <SlidersHorizontal size={14} />
        Empty fields disable that batch cap for the next sync run.
      </div>
    </div>
  );
}

const labelStyle = {
  fontSize: "0.875rem",
  color: "var(--text-secondary)",
};

const hintStyle = {
  minHeight: "2.4em",
  color: "var(--text-muted)",
  fontSize: "0.75rem",
  lineHeight: 1.35,
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

const secondaryButtonStyle = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid var(--border-subtle)",
  color: "var(--text-primary)",
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
