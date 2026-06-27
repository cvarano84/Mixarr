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
  | "audioFeatureMinimumConfidence"
  | "providerDelayMs";

type FormState = Record<SyncOptionKey, string> & {
  bpmReprocessNoDataFailed: boolean;
  enableLocalAudioFeatureFallback: boolean;
  preferApiAudioFeatures: boolean;
  allowEstimatedMoodAcousticness: boolean;
  reprocessLocalAudioFeatures: boolean;
  localAudioFeaturesScope: "windows" | "whole_track" | "";
  includeEstimatedAudioFeaturesInFilters: boolean;
  rateLimitBackoffEnabled: boolean;
};

const emptyState: FormState = {
  plexPageSize: "",
  popularityBatchSize: "",
  audioFeatureBatchSize: "",
  tagBatchSize: "",
  bpmBatchSize: "",
  audioFeatureMinimumConfidence: "",
  providerDelayMs: "",
  bpmReprocessNoDataFailed: false,
  enableLocalAudioFeatureFallback: true,
  preferApiAudioFeatures: true,
  allowEstimatedMoodAcousticness: true,
  reprocessLocalAudioFeatures: false,
  localAudioFeaturesScope: "",
  includeEstimatedAudioFeaturesInFilters: false,
  rateLimitBackoffEnabled: true,
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
    key: "audioFeatureMinimumConfidence",
    label: "Minimum audio-feature confidence",
    hint: "Blank allows all real values. Playlist filters can require a 0.0-1.0 confidence floor.",
    placeholder: "No confidence floor",
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
      nextState.bpmReprocessNoDataFailed = res.data?.bpmReprocessNoDataFailed === true;
      nextState.enableLocalAudioFeatureFallback = res.data?.enableLocalAudioFeatureFallback !== false;
      nextState.preferApiAudioFeatures = res.data?.preferApiAudioFeatures !== false;
      nextState.allowEstimatedMoodAcousticness = res.data?.allowEstimatedMoodAcousticness !== false;
      nextState.reprocessLocalAudioFeatures = res.data?.reprocessLocalAudioFeatures === true;
      nextState.localAudioFeaturesScope = res.data?.localAudioFeaturesScope === "whole_track" ? "whole_track" : res.data?.localAudioFeaturesScope === "windows" ? "windows" : "";
      nextState.includeEstimatedAudioFeaturesInFilters = res.data?.includeEstimatedAudioFeaturesInFilters === true;
      nextState.rateLimitBackoffEnabled = res.data?.rateLimitBackoffEnabled !== false;
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
      const res = await axios.put("/api/settings/sync-options", {
        ...payload,
        bpmReprocessNoDataFailed: form.bpmReprocessNoDataFailed,
        enableLocalAudioFeatureFallback: form.enableLocalAudioFeatureFallback,
        preferApiAudioFeatures: form.preferApiAudioFeatures,
        allowEstimatedMoodAcousticness: form.allowEstimatedMoodAcousticness,
        reprocessLocalAudioFeatures: form.reprocessLocalAudioFeatures,
        localAudioFeaturesScope: form.localAudioFeaturesScope || null,
        includeEstimatedAudioFeaturesInFilters: form.includeEstimatedAudioFeaturesInFilters,
        rateLimitBackoffEnabled: form.rateLimitBackoffEnabled,
      });
      const nextState = { ...emptyState };
      fields.forEach(({ key }) => {
        const value = res.data?.[key];
        nextState[key] = value === null || value === undefined ? "" : String(value);
      });
      nextState.bpmReprocessNoDataFailed = res.data?.bpmReprocessNoDataFailed === true;
      nextState.enableLocalAudioFeatureFallback = res.data?.enableLocalAudioFeatureFallback !== false;
      nextState.preferApiAudioFeatures = res.data?.preferApiAudioFeatures !== false;
      nextState.allowEstimatedMoodAcousticness = res.data?.allowEstimatedMoodAcousticness !== false;
      nextState.reprocessLocalAudioFeatures = res.data?.reprocessLocalAudioFeatures === true;
      nextState.localAudioFeaturesScope = res.data?.localAudioFeaturesScope === "whole_track" ? "whole_track" : res.data?.localAudioFeaturesScope === "windows" ? "windows" : "";
      nextState.includeEstimatedAudioFeaturesInFilters = res.data?.includeEstimatedAudioFeaturesInFilters === true;
      nextState.rateLimitBackoffEnabled = res.data?.rateLimitBackoffEnabled !== false;
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
      nextState.bpmReprocessNoDataFailed = res.data?.bpmReprocessNoDataFailed === true;
      nextState.enableLocalAudioFeatureFallback = res.data?.enableLocalAudioFeatureFallback !== false;
      nextState.preferApiAudioFeatures = res.data?.preferApiAudioFeatures !== false;
      nextState.allowEstimatedMoodAcousticness = res.data?.allowEstimatedMoodAcousticness !== false;
      nextState.reprocessLocalAudioFeatures = res.data?.reprocessLocalAudioFeatures === true;
      nextState.localAudioFeaturesScope = res.data?.localAudioFeaturesScope === "whole_track" ? "whole_track" : res.data?.localAudioFeaturesScope === "windows" ? "windows" : "";
      nextState.includeEstimatedAudioFeaturesInFilters = res.data?.includeEstimatedAudioFeaturesInFilters === true;
      nextState.rateLimitBackoffEnabled = res.data?.rateLimitBackoffEnabled !== false;
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
              max={field.key === "audioFeatureMinimumConfidence" ? 1 : undefined}
              step={field.key === "audioFeatureMinimumConfidence" ? 0.05 : 1}
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

      <label style={toggleStyle}>
        <input
          type="checkbox"
          checked={form.enableLocalAudioFeatureFallback}
          onChange={(event) => setForm((current) => ({ ...current, enableLocalAudioFeatureFallback: event.target.checked }))}
          style={checkboxStyle}
        />
        <span style={{ display: "grid", gap: "0.25rem" }}>
          <span style={labelStyle}>Enable local audio feature fallback</span>
          <span style={hintStyle}>
            Analyze local files with Essentia when API providers do not return complete audio features.
          </span>
        </span>
      </label>

      <label style={toggleStyle}>
        <input
          type="checkbox"
          checked={form.preferApiAudioFeatures}
          onChange={(event) => setForm((current) => ({ ...current, preferApiAudioFeatures: event.target.checked }))}
          style={checkboxStyle}
        />
        <span style={{ display: "grid", gap: "0.25rem" }}>
          <span style={labelStyle}>Prefer API audio features when available</span>
          <span style={hintStyle}>
            Keep provider-supplied fields and use Essentia only to fill missing values.
          </span>
        </span>
      </label>

      <label style={toggleStyle}>
        <input
          type="checkbox"
          checked={form.allowEstimatedMoodAcousticness}
          onChange={(event) => setForm((current) => ({ ...current, allowEstimatedMoodAcousticness: event.target.checked }))}
          style={checkboxStyle}
        />
        <span style={{ display: "grid", gap: "0.25rem" }}>
          <span style={labelStyle}>Allow estimated mood and acousticness</span>
          <span style={hintStyle}>
            Mood, acousticness, and danceability are descriptor-based estimates unless a trained API value exists.
          </span>
        </span>
      </label>

      <label style={toggleStyle}>
        <input
          type="checkbox"
          checked={form.reprocessLocalAudioFeatures}
          onChange={(event) => setForm((current) => ({ ...current, reprocessLocalAudioFeatures: event.target.checked }))}
          style={checkboxStyle}
        />
        <span style={{ display: "grid", gap: "0.25rem" }}>
          <span style={labelStyle}>Reprocess local audio features</span>
          <span style={hintStyle}>
            Re-run Essentia for local, partial, and failed local audio-feature rows on the next audio-feature sync.
          </span>
        </span>
      </label>

      <label style={{ display: "grid", gap: "0.35rem" }}>
        <span style={labelStyle}>Local audio feature analysis scope</span>
        <select
          value={form.localAudioFeaturesScope}
          onChange={(event) => setForm((current) => ({
            ...current,
            localAudioFeaturesScope: event.target.value === "whole_track" ? "whole_track" : event.target.value === "windows" ? "windows" : "",
          }))}
          style={inputStyle}
        >
          <option value="">Use LOCAL_AUDIO_FEATURES_SCOPE env default</option>
          <option value="windows">Window samples, faster</option>
          <option value="whole_track">Whole track, slower but potentially more accurate</option>
        </select>
        <span style={hintStyle}>
          Windows analyzes 30s-90s, middle 60s, and last third 60s. Whole track analyzes the entire song and may be slower.
        </span>
      </label>

      <label style={toggleStyle}>
        <input
          type="checkbox"
          checked={form.includeEstimatedAudioFeaturesInFilters}
          onChange={(event) => setForm((current) => ({ ...current, includeEstimatedAudioFeaturesInFilters: event.target.checked }))}
          style={checkboxStyle}
        />
        <span style={{ display: "grid", gap: "0.25rem" }}>
          <span style={labelStyle}>Include estimated features in playlist filters</span>
          <span style={hintStyle}>
            Energy and mood filters can use heuristic local values only when this is enabled.
          </span>
        </span>
      </label>

      <label style={toggleStyle}>
        <input
          type="checkbox"
          checked={form.bpmReprocessNoDataFailed}
          onChange={(event) => setForm((current) => ({ ...current, bpmReprocessNoDataFailed: event.target.checked }))}
          style={checkboxStyle}
        />
        <span style={{ display: "grid", gap: "0.25rem" }}>
          <span style={labelStyle}>Retry BPM no-data and failed/extraction-failed tracks</span>
          <span style={hintStyle}>
            Off keeps confirmed no-data and failed BPM attempts out of the queue. On retries them, including extraction failures, on the next BPM backfill run.
          </span>
        </span>
      </label>

      <label style={toggleStyle}>
        <input
          type="checkbox"
          checked={form.rateLimitBackoffEnabled}
          onChange={(event) => setForm((current) => ({ ...current, rateLimitBackoffEnabled: event.target.checked }))}
          style={checkboxStyle}
        />
        <span style={{ display: "grid", gap: "0.25rem" }}>
          <span style={labelStyle}>Retry preferred provider after rate limits</span>
          <span style={hintStyle}>
            On leaves the track queued for the preferred provider. Off continues to the next fallback provider when one is available.
          </span>
        </span>
      </label>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
        <button onClick={saveSettings} disabled={saving} style={buttonStyle}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          {saved ? "Saved" : "Save Sync Options"}
        </button>
        <button onClick={clearLimits} disabled={saving} style={secondaryButtonStyle}>
          <RotateCcw size={16} />
          Reset Sync Options
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

const toggleStyle = {
  alignItems: "flex-start",
  background: "rgba(255,255,255,0.035)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  display: "flex",
  gap: "0.75rem",
  padding: "0.85rem",
};

const checkboxStyle = {
  accentColor: "var(--accent-primary)",
  flex: "0 0 auto",
  height: "1rem",
  marginTop: "0.15rem",
  width: "1rem",
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
