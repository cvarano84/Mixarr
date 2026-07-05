"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { HeartPulse } from "lucide-react";
import styles from "../app/page.module.css";

// We keep this shape loose on purpose - it mirrors getLibraryHealth()'s return
// object, and the homepage only reads the handful of fields aggregated below.
type HealthLibrary = {
  activeTracks: number;
  missingTracks: number;
  tracksWithBpm: number;
  bpmApi: number;
  bpmLocal: number;
  bpmImported: number;
  missingBpm: number;
  bpmFailed: number;
  audioFeaturesComplete: number;
  audioFeaturesApi: number;
  audioFeaturesLocal: number;
  audioFeaturesHeuristic: number;
  audioFeaturesPartial: number;
  audioFeaturesMissing: number;
  audioFeaturesFailed: number;
  status: "healthy" | "warning" | "error";
  lastFullSyncAt: string | null;
  bpmProviderMode?: string;
  audioFeatureProviderMode?: string;
};

export default function LibraryHealthPanel() {
  const [health, setHealth] = useState<HealthLibrary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get("/api/settings/library-health", { validateStatus: (status) => status < 600 });
        if (cancelled) return;
        if (res.status >= 400 || !Array.isArray(res.data?.libraries)) {
          setFailed(true);
          return;
        }
        setHealth(res.data.libraries as HealthLibrary[]);
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load library health", error);
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // On error we render nothing rather than blocking the dashboard, so a slow or
  // failing health query can never hold up the rest of the page again.
  if (failed) return null;
  if (health === null) return <LibraryHealthSkeleton />;
  if (health.length === 0) return null;

  const active = health.reduce((sum, library) => sum + library.activeTracks, 0);
  const missing = health.reduce((sum, library) => sum + library.missingTracks, 0);
  const bpmComplete = health.reduce((sum, library) => sum + library.tracksWithBpm, 0);
  const bpmApi = health.reduce((sum, library) => sum + library.bpmApi, 0);
  const bpmLocal = health.reduce((sum, library) => sum + library.bpmLocal, 0);
  const bpmImported = health.reduce((sum, library) => sum + library.bpmImported, 0);
  const bpmMissing = health.reduce((sum, library) => sum + library.missingBpm, 0);
  const bpmFailed = health.reduce((sum, library) => sum + library.bpmFailed, 0);
  const audioComplete = health.reduce((sum, library) => sum + library.audioFeaturesComplete, 0);
  const audioApi = health.reduce((sum, library) => sum + library.audioFeaturesApi, 0);
  const audioLocal = health.reduce((sum, library) => sum + library.audioFeaturesLocal, 0);
  const audioEstimated = health.reduce((sum, library) => sum + library.audioFeaturesHeuristic, 0);
  const audioPartial = health.reduce((sum, library) => sum + library.audioFeaturesPartial, 0);
  const audioMissing = health.reduce((sum, library) => sum + library.audioFeaturesMissing, 0);
  const audioFailed = health.reduce((sum, library) => sum + library.audioFeaturesFailed, 0);
  const status = health.some((library) => library.status === "error") ? "Error" : health.some((library) => library.status === "warning") ? "Warning" : "Healthy";
  const latest = health.map((library) => library.lastFullSyncAt).filter(Boolean).sort().at(-1) || null;
  const bpmMode = health[0].bpmProviderMode || "API + Local, API preferred";
  const audioMode = health[0].audioFeatureProviderMode || "API + Local, API preferred";

  return (
    <>
      <Link href="/settings/library-health" className={`glass-panel ${styles.healthWidget}`}>
        <HeartPulse size={22} />
        <div><strong>Library Health</strong><span>Active: {active.toLocaleString()} &middot; Missing: {missing.toLocaleString()} &middot; Last sync: {latest ? new Date(latest).toLocaleString() : "Never"}</span></div>
        <b data-status={status.toLowerCase()}>{status}</b>
      </Link>
      <div className={styles.cardsGrid} style={{ marginBottom: "1.5rem" }}>
        <Link href="/settings/library-health?section=bpm&filter=tracks_with_bpm" className={styles.card}>
          <h3>BPM / Tempo</h3>
          <p>{bpmComplete.toLocaleString()} / {active.toLocaleString()}</p>
          <p>API: {bpmApi.toLocaleString()} &middot; Local Essentia: {bpmLocal.toLocaleString()}</p>
          <p>Imported: {bpmImported.toLocaleString()} &middot; Missing: {bpmMissing.toLocaleString()} &middot; Failed: {bpmFailed.toLocaleString()}</p>
          <p>Mode: {bpmMode}</p>
        </Link>
        <Link href="/settings/library-health?section=audio&filter=missing_audio_features" className={styles.card}>
          <h3>Audio Features</h3>
          <p>{audioComplete.toLocaleString()} / {active.toLocaleString()}</p>
          <p>API: {audioApi.toLocaleString()} &middot; Local Essentia: {audioLocal.toLocaleString()}</p>
          <p>Estimated: {audioEstimated.toLocaleString()} &middot; Partial: {audioPartial.toLocaleString()} &middot; Missing: {audioMissing.toLocaleString()} &middot; Failed: {audioFailed.toLocaleString()}</p>
          <p>Mode: {audioMode}</p>
        </Link>
      </div>
    </>
  );
}

function LibraryHealthSkeleton() {
  return (
    <>
      <div className={`glass-panel ${styles.healthWidget}`} aria-hidden="true" style={{ opacity: 0.55 }}>
        <HeartPulse size={22} />
        <div><strong>Library Health</strong><span>Loading library health&hellip;</span></div>
        <b>&nbsp;</b>
      </div>
      <div className={styles.cardsGrid} style={{ marginBottom: "1.5rem" }} aria-hidden="true">
        <div className={styles.card} style={{ opacity: 0.55, cursor: "default" }}>
          <h3>BPM / Tempo</h3>
          <p>&hellip;</p>
        </div>
        <div className={styles.card} style={{ opacity: 0.55, cursor: "default" }}>
          <h3>Audio Features</h3>
          <p>&hellip;</p>
        </div>
      </div>
    </>
  );
}
