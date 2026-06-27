import { GLOBAL_SYNC_JOB_KEY, acquireJobLock, type ActiveJob } from "./jobLock";
import { markEnrichmentJobFinished, markEnrichmentJobStarted } from "./enrichmentJobStatus";

export const engineLabels: Record<string, string> = {
  initial: "initial enrichment",
  plex: "Plex metadata",
  popularity: "popularity",
  audio: "audio features",
  bpm: "BPM",
  tags: "track genres",
};

export function syncJobKeys(engine: string, libraryId?: string) {
  const keys = [GLOBAL_SYNC_JOB_KEY, engine];
  if (engine === "plex" && libraryId) keys.push(`plex:${libraryId}`);
  if (engine === "initial") keys.push("popularity", "tags", "audio", "bpm");
  return keys;
}

export function alreadyRunningPayload(engine: string, activeJob: ActiveJob) {
  return {
    status: "already_running",
    message: `${engineLabels[engine] || engine} sync is already in progress (${activeJob.name}).`,
    activeJob: {
      name: activeJob.name,
      startedAt: activeJob.startedAt,
      phase: activeJob.phase || null,
    },
  };
}

export function startSyncJobInBackground({
  engine,
  libraryId,
  source = "manual",
  trackedEngine,
  task,
}: {
  engine: string;
  libraryId?: string;
  source?: string;
  trackedEngine?: string;
  task: () => Promise<unknown>;
}) {
  const lock = acquireJobLock({
    name: `${engineLabels[engine] || engine} sync`,
    keys: syncJobKeys(engine, libraryId),
    source,
  });

  if (!lock.acquired) {
    return { started: false as const, activeJob: lock.activeJob };
  }

  if (trackedEngine) markEnrichmentJobStarted(trackedEngine);
  task()
    .then((result) => {
      if (trackedEngine) markEnrichmentJobFinished(trackedEngine, result);
    })
    .catch((error) => {
      if (trackedEngine) markEnrichmentJobFinished(trackedEngine, undefined, error);
      console.error(error);
    })
    .finally(() => lock.release());

  return { started: true as const, job: lock.job };
}
