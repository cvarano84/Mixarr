export type PrismaPoolTimeoutContext = {
  context: string;
  model?: string;
};

type DatabasePressureState = {
  lastPoolTimeoutAt?: string;
  recentPoolTimeouts: number[];
  lastLogByContext: Record<string, number>;
};

const globalDatabasePressure = globalThis as typeof globalThis & {
  mixarrDatabasePressure?: DatabasePressureState;
};

const databasePressure = globalDatabasePressure.mixarrDatabasePressure ?? {
  recentPoolTimeouts: [],
  lastLogByContext: {},
};
globalDatabasePressure.mixarrDatabasePressure = databasePressure;

const RECENT_WINDOW_MS = 15 * 60 * 1000;
const LOG_THROTTLE_MS = 60 * 1000;

function errorText(error: unknown) {
  const candidate = error as any;
  return [
    candidate?.message,
    candidate?.code,
    candidate?.meta?.modelName,
    candidate?.meta?.connection_limit,
    candidate?.meta?.timeout,
  ].filter(Boolean).join(" ");
}

export function isPrismaConnectionPoolTimeout(error: unknown) {
  const candidate = error as any;
  return candidate?.code === "P2024" || /timed out fetching a new connection from the connection pool/i.test(errorText(error));
}

function prune(now: number) {
  databasePressure.recentPoolTimeouts = databasePressure.recentPoolTimeouts.filter((timestamp) => now - timestamp <= RECENT_WINDOW_MS);
}

export function recordPrismaPoolTimeout(error: unknown) {
  const now = Date.now();
  prune(now);
  databasePressure.recentPoolTimeouts.push(now);
  databasePressure.lastPoolTimeoutAt = new Date(now).toISOString();

  const candidate = error as any;
  return {
    model: candidate?.meta?.modelName,
    limit: candidate?.meta?.connection_limit,
    timeout: candidate?.meta?.timeout,
  };
}

export function logPrismaPoolTimeoutOnce(error: unknown, { context, model }: PrismaPoolTimeoutContext) {
  const details = recordPrismaPoolTimeout(error);
  const now = Date.now();
  const lastLog = databasePressure.lastLogByContext[context] || 0;
  if (now - lastLog < LOG_THROTTLE_MS) return;

  databasePressure.lastLogByContext[context] = now;
  const resolvedModel = model || details.model || "unknown";
  const limit = details.limit ?? "unknown";
  const timeout = details.timeout ?? "unknown";
  console.warn(
    `[Database] Prisma connection pool timeout in ${context}. The app is busy or too many DB queries are running. ` +
    `model=${resolvedModel} limit=${limit} timeout=${timeout}s`,
  );
}

export function getDatabasePoolPressureSnapshot(now = Date.now()) {
  prune(now);
  return {
    lastPoolTimeoutAt: databasePressure.lastPoolTimeoutAt || null,
    recentPoolTimeouts: databasePressure.recentPoolTimeouts.length,
  };
}

export function buildPoolBusyStatusPayload(error: unknown, context: PrismaPoolTimeoutContext) {
  logPrismaPoolTimeoutOnce(error, context);
  return {
    status: "busy",
    warning: "Database connection pool is currently busy. Sync may still be running.",
    poolBusy: true,
    retryAfterSeconds: 30,
    database: getDatabasePoolPressureSnapshot(),
  };
}
