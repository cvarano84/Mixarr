import prisma from "./prisma";

export type EnrichmentRunSummary = {
  attempted: number;
  processed: number;
  skipped: number;
  failed: number;
};

type TrackClient = {
  track: {
    findMany: (args: any) => Promise<any[]>;
    findUnique: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
  };
};

type SafeTrackBatchOptions<T> = {
  engineName: string;
  where: any;
  select: any;
  orderBy?: any;
  take?: number;
  fetchBatchSize?: number;
  client?: TrackClient;
  process: (track: T) => Promise<"processed" | "failed" | void>;
};

const conversionFailurePattern = /convert rust String into napi string|failed to convert[^\n]*napi string/i;

export function isPrismaStringConversionFailure(error: unknown) {
  const candidate = error as any;
  return conversionFailurePattern.test([
    candidate?.message,
    candidate?.code,
    candidate?.meta?.message,
  ].filter(Boolean).join(" "));
}

function leafSelectPaths(select: any, prefix: string[] = []): string[][] {
  return Object.entries(select || {}).flatMap(([key, value]) => {
    if (value === true) return [[...prefix, key]];
    if (value && typeof value === "object" && "select" in value) {
      return leafSelectPaths((value as any).select, [...prefix, key]);
    }
    return [];
  });
}

function selectForPath(path: string[]): any {
  const [head, ...tail] = path;
  return tail.length === 0
    ? { [head]: true }
    : { [head]: { select: selectForPath(tail) } };
}

async function probe<T>(operation: () => Promise<T>): Promise<T | undefined> {
  try {
    return await operation();
  } catch {
    return undefined;
  }
}

async function diagnoseAndQuarantine(
  client: TrackClient,
  engineName: string,
  trackId: string,
  select: any,
) {
  const suspectedFields: string[] = [];
  for (const path of leafSelectPaths(select).filter((path) => path.join(".") !== "id")) {
    try {
      await client.track.findUnique({
        where: { id: trackId },
        select: { id: true, ...selectForPath(path) },
      });
    } catch (error) {
      if (isPrismaStringConversionFailure(error)) suspectedFields.push(path.join("."));
    }
  }

  const rating = await probe(() => client.track.findUnique({
    where: { id: trackId },
    select: { ratingKey: true, plexId: true },
  }));
  const library = await probe(() => client.track.findUnique({
    where: { id: trackId },
    select: { libraryId: true, library: { select: { name: true } } },
  }));

  await client.track.updateMany({
    where: { id: trackId },
    data: { syncStatus: "metadata_corrupt" },
  });

  console.error(
    `[${engineName}] Skipping corrupt Track metadata row. ` +
    `trackId=${trackId}, ratingKey=${rating?.ratingKey ?? rating?.plexId ?? "unknown"}, ` +
    `libraryId=${library?.libraryId ?? "unknown"}, library=${library?.library?.name ?? "unknown"}, ` +
    `suspectedField=${suspectedFields.join(",") || "unknown"}. ` +
    "Prisma could not deserialize this string. Re-sync or fix metadata in Plex; the row was quarantined until metadata sync repairs it.",
  );
}

export async function safeTrackBatchIterator<T>({
  engineName,
  where,
  select,
  orderBy = { id: "asc" },
  take,
  fetchBatchSize = 50,
  client = prisma as unknown as TrackClient,
  process,
}: SafeTrackBatchOptions<T>): Promise<EnrichmentRunSummary> {
  const ids = await client.track.findMany({
    where,
    select: { id: true },
    orderBy,
    ...(take ? { take } : {}),
  });
  const summary: EnrichmentRunSummary = {
    attempted: ids.length,
    processed: 0,
    skipped: 0,
    failed: 0,
  };
  const rows: T[] = [];

  const load = async (batchIds: string[]): Promise<void> => {
    if (batchIds.length === 0) return;
    try {
      const batch = await client.track.findMany({
        where: { id: { in: batchIds } },
        select,
      });
      const byId = new Map(batch.map((row) => [row.id, row]));
      for (const id of batchIds) {
        const row = byId.get(id);
        if (row) rows.push(row as T);
      }
    } catch (error) {
      if (!isPrismaStringConversionFailure(error)) throw error;
      if (batchIds.length > 1) {
        const middle = Math.floor(batchIds.length / 2);
        await load(batchIds.slice(0, middle));
        await load(batchIds.slice(middle));
        return;
      }
      summary.skipped += 1;
      await diagnoseAndQuarantine(client, engineName, batchIds[0], select);
    }
  };

  for (let offset = 0; offset < ids.length; offset += fetchBatchSize) {
    await load(ids.slice(offset, offset + fetchBatchSize).map((row) => row.id));
  }

  for (const row of rows) {
    try {
      const outcome = await process(row);
      if (outcome === "failed") summary.failed += 1;
      else summary.processed += 1;
    } catch (error) {
      summary.failed += 1;
      console.error(`[${engineName}] Track processing failed after safe metadata load:`, error);
    }
  }

  console.log(
    `[${engineName}] Batch summary: attempted=${summary.attempted}, processed=${summary.processed}, skipped=${summary.skipped}, failed=${summary.failed}.`,
  );
  return summary;
}
