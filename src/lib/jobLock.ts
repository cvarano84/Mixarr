export const GLOBAL_SYNC_JOB_KEY = "global:sync";

export type ActiveJob = {
  id: string;
  name: string;
  source: string;
  keys: string[];
  startedAt: string;
  phase?: string;
};

type JobLockState = {
  activeByKey: Record<string, ActiveJob>;
  lastSkipped?: {
    name: string;
    source: string;
    skippedAt: string;
    activeJob: ActiveJob;
  };
};

const globalJobLocks = globalThis as typeof globalThis & {
  mixarrJobLocks?: JobLockState;
};

const jobLocks = globalJobLocks.mixarrJobLocks ?? { activeByKey: {} };
globalJobLocks.mixarrJobLocks = jobLocks;

function jobId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function uniqueJobs() {
  const seen = new Set<string>();
  return Object.values(jobLocks.activeByKey).filter((job) => {
    if (seen.has(job.id)) return false;
    seen.add(job.id);
    return true;
  });
}

export function getJobConflict(keys: string[]) {
  for (const key of keys) {
    const job = jobLocks.activeByKey[key];
    if (job) return job;
  }
  return null;
}

export function acquireJobLock({
  name,
  keys,
  source = "manual",
}: {
  name: string;
  keys: string[];
  source?: string;
}) {
  const normalizedKeys = Array.from(new Set(keys));
  const activeJob = getJobConflict(normalizedKeys);
  if (activeJob) {
    jobLocks.lastSkipped = {
      name,
      source,
      skippedAt: new Date().toISOString(),
      activeJob,
    };
    console.warn(`[JobLock] Skipping ${name}; ${activeJob.name} is already running.`);
    return { acquired: false as const, activeJob };
  }

  const job: ActiveJob = {
    id: jobId(),
    name,
    source,
    keys: normalizedKeys,
    startedAt: new Date().toISOString(),
  };
  for (const key of normalizedKeys) jobLocks.activeByKey[key] = job;
  console.log(`[JobLock] Started ${name} (${job.id}).`);

  return {
    acquired: true as const,
    job,
    release: () => releaseJobLock(job),
  };
}

export function releaseJobLock(job: ActiveJob) {
  for (const key of job.keys) {
    if (jobLocks.activeByKey[key]?.id === job.id) {
      delete jobLocks.activeByKey[key];
    }
  }
  console.log(`[JobLock] Finished ${job.name} (${job.id}).`);
}

export function setJobPhase(job: ActiveJob, phase: string) {
  job.phase = phase;
  for (const key of job.keys) {
    if (jobLocks.activeByKey[key]?.id === job.id) {
      jobLocks.activeByKey[key] = job;
    }
  }
}

export function getJobDebugSnapshot(now = Date.now()) {
  const activeJobs = uniqueJobs().map((job) => {
    const started = new Date(job.startedAt).getTime();
    return {
      id: job.id,
      name: job.name,
      source: job.source,
      startedAt: job.startedAt,
      durationSeconds: Number.isFinite(started) ? Math.max(0, Math.round((now - started) / 1000)) : 0,
      phase: job.phase || null,
    };
  });

  return {
    activeJob: activeJobs.find((job) => job.id === jobLocks.activeByKey[GLOBAL_SYNC_JOB_KEY]?.id) || activeJobs[0] || null,
    activeJobs,
    queuedJobs: 0,
    lastSkipped: jobLocks.lastSkipped || null,
  };
}

export function resetJobLocksForTests() {
  jobLocks.activeByKey = {};
  jobLocks.lastSkipped = undefined;
}
