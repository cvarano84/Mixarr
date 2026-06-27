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
  enableApiBpm: boolean;
  enableLocalBpm: boolean;
  preferLocalBpm: boolean;
  reprocessApiBpmWithLocal: boolean;
  localBpmAnalysisScope: "windows" | "whole_track" | "";
  enableApiAudioFeatures: boolean;
  enableLocalAudioFeatures: boolean;
  preferLocalAudioFeatures: boolean;
  reprocessApiAudioFeaturesWithLocal: boolean;
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
  enableApiBpm: true,
  enableLocalBpm: true,
  preferLocalBpm: false,
  reprocessApiBpmWithLocal: false,
  localBpmAnalysisScope: "",
  enableApiAudioFeatures: true,
  enableLocalAudioFeatures: true,
  preferLocalAudioFeatures: false,
  reprocessApiAudioFeaturesWithLocal: false,
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
      nextState.enableApiBpm = res.data?.enableApiBpm !== false;
      nextState.enableLocalBpm = res.data?.enableLocalBpm !== false;
      nextState.preferLocalBpm = res.data?.preferLocalBpm === true;
      nextState.reprocessApiBpmWithLocal = res.data?.reprocessApiBpmWithLocal === true;
      nextState.localBpmAnalysisScope = res.data?.localBpmAnalysisScope === "whole_track" ? "whole_track" : res.data?.localBpmAnalysisScope === "windows" ? "windows" : "";
      nextState.enableApiAudioFeatures = res.data?.enableApiAudioFeatures !== false;
      nextState.enableLocalAudioFeatures = res.data?.enableLocalAudioFeatures ?? res.data?.enableLocalAudioFeatureFallback !== false;
      nextState.preferLocalAudioFeatures = res.data?.preferLocalAudioFeatures === true;
      nextState.reprocessApiAudioFeaturesWithLocal = res.data?.reprocessApiAudioFeaturesWithLocal === true;
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
        enableApiBpm: form.enableApiBpm,
        enableLocalBpm: form.enableLocalBpm,
        preferLocalBpm: form.preferLocalBpm,
        reprocessApiBpmWithLocal: form.reprocessApiBpmWithLocal,
        localBpmAnalysisScope: form.localBpmAnalysisScope || null,
        enableApiAudioFeatures: form.enableApiAudioFeatures,
        enableLocalAudioFeatures: form.enableLocalAudioFeatures,
        preferLocalAudioFeatures: form.preferLocalAudioFeatures,
        reprocessApiAudioFeaturesWithLocal: form.reprocessApiAudioFeaturesWithLocal,
        enableLocalAudioFeatureFallback: form.enableLocalAudioFeatures,
        preferApiAudioFeatures: !form.preferLocalAudioFeatures,
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
      nextState.enableApiBpm = res.data?.enableApiBpm !== false;
      nextState.enableLocalBpm = res.data?.enableLocalBpm !== false;
      nextState.preferLocalBpm = res.data?.preferLocalBpm === true;
      nextState.reprocessApiBpmWithLocal = res.data?.reprocessApiBpmWithLocal === true;
      nextState.localBpmAnalysisScope = res.data?.localBpmAnalysisScope === "whole_track" ? "whole_track" : res.data?.localBpmAnalysisScope === "windows" ? "windows" : "";
      nextState.enableApiAudioFeatures = res.data?.enableApiAudioFeatures !== false;
      nextState.enableLocalAudioFeatures = res.data?.enableLocalAudioFeatures ?? res.data?.enableLocalAudioFeatureFallback !== false;
      nextState.preferLocalAudioFeatures = res.data?.preferLocalAudioFeatures === true;
      nextState.reprocessApiAudioFeaturesWithLocal = res.data?.reprocessApiAudioFeaturesWithLocal === true;
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
      nextState.enableApiBpm = res.data?.enableApiBpm !== false;
      nextState.enableLocalBpm = res.data?.enableLocalBpm !== false;
      nextState.preferLocalBpm = res.data?.preferLocalBpm === true;
      nextState.reprocessApiBpmWithLocal = res.data?.reprocessApiBpmWithLocal === true;
      nextState.localBpmAnalysisScope = res.data?.localBpmAnalysisScope === "whole_track" ? "whole_track" : res.data?.localBpmAnalysisScope === "windows" ? "windows" : "";
      nextState.enableApiAudioFeatures = res.data?.enableApiAudioFeatures !== false;
      nextState.enableLocalAudioFeatures = res.data?.enableLocalAudioFeatures ?? res.data?.enableLocalAudioFeatureFallback !== false;
      nextState.preferLocalAudioFeatures = res.data?.preferLocalAudioFeatures === true;
      nextState.reprocessApiAudioFeaturesWithLocal = res.data?.reprocessApiAudioFeaturesWithLocal === true;
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

      <div style={sectionGroupStyle}>
        <div>
          <h4 style={sectionTitleStyle}>BPM / Tempo Providers</h4>
          <p style={sectionCopyStyle}>API mode uses external metadata/audio feature providers when available. Local Essentia mode analyzes your local media files directly. This is slower but self-hosted and works when API data is missing.</p>
        </div>
        <label style={toggleStyle}>
          <input
            type="checkbox"
            checked={form.enableApiBpm}
            onChange={(event) => setForm((current) => ({ ...current, enableApiBpm: event.target.checked }))}
            style={checkboxStyle}
          />
          <span style={{ display: "grid", gap: "0.25rem" }}>
            <span style={labelStyle}>Enable API BPM lookup</span>
            <span style={hintStyle}>Uses external metadata/audio feature providers when available.</span>
          </span>
        </label>
        <label style={toggleStyle}>
          <input
            type="checkbox"
            checked={form.enableLocalBpm}
            onChange={(event) => setForm((current) => ({ ...current, enableLocalBpm: event.target.checked }))}
            style={checkboxStyle}
          />
          <span style={{ display: "grid", gap: "0.25rem" }}>
            <span style={labelStyle}>Enable local Essentia BPM analysis</span>
            <span style={hintStyle}>Analyzes your local media files directly. This is slower but self-hosted and works when API data is missing.</span>
          </span>
        </label>
        <label style={toggleStyle}>
          <input
            type="checkbox"
            checked={form.preferLocalBpm}
            onChange={(event) => setForm((current) => ({ ...current, preferLocalBpm: event.target.checked }))}
            style={checkboxStyle}
          />
          <span style={{ display: "grid", gap: "0.25rem" }}>
            <span style={labelStyle}>Prefer local BPM over API BPM</span>
            <span style={hintStyle}>Use local Essentia values as the effective value when both API and local data exist.</span>
          </span>
        </label>
        <label style={toggleStyle}>
          <input
            type="checkbox"
            checked={form.reprocessApiBpmWithLocal}
            onChange={(event) => setForm((current) => ({ ...current, reprocessApiBpmWithLocal: event.target.checked }))}
            style={checkboxStyle}
          />
          <span style={{ display: "grid", gap: "0.25rem" }}>
            <span style={labelStyle}>Reprocess existing API BPM with local Essentia</span>
            <span style={hintStyle}>Queue local analysis even for tracks that already have API BPM data.</span>
          </span>
        </label>
        <label style={{ display: "grid", gap: "0.35rem" }}>
          <span style={labelStyle}>BPM analysis scope</span>
          <select
            value={form.localBpmAnalysisScope}
            onChange={(event) => setForm((current) => ({
              ...current,
              localBpmAnalysisScope: event.target.value === "whole_track" ? "whole_track" : event.target.value === "windows" ? "windows" : "",
            }))}
            style={inputStyle}
          >
            <option value="">Use LOCAL_BPM_ANALYSIS_SCOPE env default</option>
            <option value="windows">Window samples, faster</option>
            <option value="whole_track">Whole track, slower but potentially more accurate</option>
          </select>
        </label>
      </div>

      <div style={sectionGroupStyle}>
        <div>
          <h4 style={sectionTitleStyle}>Audio Feature Providers</h4>
          <p style={sectionCopyStyle}>API mode uses external metadata/audio feature providers when available. Local Essentia mode analyzes your local media files directly. This is slower but self-hosted and works when API data is missing.</p>
        </div>
        <label style={toggleStyle}>
          <input
            type="checkbox"
            checked={form.enableApiAudioFeatures}
            onChange={(event) => setForm((current) => ({ ...current, enableApiAudioFeatures: event.target.checked }))}
            style={checkboxStyle}
          />
          <span style={{ display: "grid", gap: "0.25rem" }}>
            <span style={labelStyle}>Enable API Audio Feature lookup</span>
            <span style={hintStyle}>Uses external metadata/audio feature providers when available.</span>
          </span>
        </label>

      <label style={toggleStyle}>
        <input
          type="checkbox"
          checked={form.enableLocalAudioFeatures}
          onChange={(event) => setForm((current) => ({ ...current, enableLocalAudioFeatures: event.target.checked }))}
          style={checkboxStyle}
        />
        <span style={{ display: "grid", gap: "0.25rem" }}>
          <span style={labelStyle}>Enable local Essentia Audio Feature analysis</span>
          <span style={hintStyle}>
            Analyzes your local media files directly. This is slower but self-hosted and works when API data is missing.
          </span>
        </span>
      </label>

      <label style={toggleStyle}>
        <input
          type="checkbox"
          checked={form.preferLocalAudioFeatures}
          onChange={(event) => setForm((current) => ({ ...current, preferLocalAudioFeatures: event.target.checked }))}
          style={checkboxStyle}
        />
        <span style={{ display: "grid", gap: "0.25rem" }}>
          <span style={labelStyle}>Prefer local Audio Features over API Audio Features</span>
          <span style={hintStyle}>
            Use local Essentia values as the effective value when both API and local data exist.
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
            Mood, danceability, and acousticness can use clearly marked local_heuristic estimated values.
          </span>
        </span>
      </label>

      <label style={toggleStyle}>
        <input
          type="checkbox"
          checked={form.reprocessApiAudioFeaturesWithLocal}
          onChange={(event) => setForm((current) => ({ ...current, reprocessApiAudioFeaturesWithLocal: event.target.checked }))}
          style={checkboxStyle}
        />
        <span style={{ display: "grid", gap: "0.25rem" }}>
          <span style={labelStyle}>Reprocess existing API Audio Features with local Essentia</span>
          <span style={hintStyle}>
            Queue local analysis even for tracks that already have API audio-feature data.
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
      </div>

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

const sectionGroupStyle = {
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-md)",
  display: "grid",
  gap: "0.85rem",
  padding: "1rem",
};

const sectionTitleStyle = {
  color: "var(--text-primary)",
  fontSize: "1rem",
  margin: "0 0 0.35rem 0",
};

const sectionCopyStyle = {
  color: "var(--text-muted)",
  fontSize: "0.8rem",
  lineHeight: 1.4,
  margin: 0,
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
