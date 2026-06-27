type PollInput = {
  data?: any;
  httpStatus?: number;
  previousDelayMs?: number;
  failedAttempts?: number;
};

const ACTIVE_POLL_MS = 10_000;
const IDLE_POLL_MS = 30_000;
const BUSY_POLL_MS = 30_000;
const MAX_BACKOFF_MS = 120_000;

function hasRunningJob(data: any) {
  return [
    data?.popularity,
    data?.audioFeatures,
    data?.bpm,
    data?.tags,
  ].some((progress) => progress?.lastRun?.running);
}

export function nextStatusPollDelayMs({
  data,
  httpStatus,
  previousDelayMs,
  failedAttempts = 0,
}: PollInput) {
  const poolBusy = data?.poolBusy || data?.status === "busy" || httpStatus === 429 || httpStatus === 503;
  if (poolBusy) {
    const hinted = Number(data?.retryAfterSeconds);
    const base = Number.isFinite(hinted) && hinted > 0 ? hinted * 1000 : BUSY_POLL_MS;
    const previous = previousDelayMs && previousDelayMs > 0 ? previousDelayMs : base;
    return Math.min(MAX_BACKOFF_MS, Math.max(base, previous * 2));
  }

  if (failedAttempts > 0) {
    const previous = previousDelayMs && previousDelayMs > 0 ? previousDelayMs : ACTIVE_POLL_MS;
    return Math.min(MAX_BACKOFF_MS, previous * 2);
  }

  const serverSeconds = Number(data?.pollSeconds);
  if (Number.isFinite(serverSeconds) && serverSeconds > 0) return serverSeconds * 1000;

  return data?.metadata?.isSyncing || hasRunningJob(data) ? ACTIVE_POLL_MS : IDLE_POLL_MS;
}
