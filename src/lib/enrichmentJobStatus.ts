import type { EnrichmentRunSummary } from "./safeTrackBatch";

export type EnrichmentJobState = {
  running: boolean;
  startedAt: string;
  finishedAt?: string;
  summary?: EnrichmentRunSummary;
  error?: string;
};

const globalJobs = globalThis as typeof globalThis & {
  mixarrEnrichmentJobs?: Record<string, EnrichmentJobState>;
};

const jobs = globalJobs.mixarrEnrichmentJobs ?? {};
globalJobs.mixarrEnrichmentJobs = jobs;

export function markEnrichmentJobStarted(engine: string) {
  jobs[engine] = { running: true, startedAt: new Date().toISOString() };
}

export function markEnrichmentJobFinished(engine: string, result: unknown, error?: unknown) {
  const previous = jobs[engine] ?? { running: false, startedAt: new Date().toISOString() };
  jobs[engine] = {
    ...previous,
    running: false,
    finishedAt: new Date().toISOString(),
    ...(result && typeof result === "object" && "attempted" in result
      ? { summary: result as EnrichmentRunSummary }
      : {}),
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
  };
}

export function getEnrichmentJobStatuses() {
  return { ...jobs };
}
