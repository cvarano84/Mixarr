import prisma from "./prisma";
import {
  apiAudioFeatureTrackWhere,
  audioFeatureAnalyzerFailedTrackWhere,
  audioFeatureExtractionFailedTrackWhere,
  audioFeatureFailedTrackWhere,
  audioFeatureNoDataTrackWhere,
  completeAudioFeatureTrackWhere,
  heuristicAudioFeatureTrackWhere,
  localAudioFeatureTrackWhere,
  partialAudioFeatureTrackWhere,
  missingAudioFeatureTrackWhere,
} from "./audioFeatures";
import {
  bpmAnalyzerFailedTrackWhere,
  bpmAnalysisAttemptedTrackWhere,
  bpmExtractionFailedTrackWhere,
  bpmFailedTrackWhere,
  bpmNoDataTrackWhere,
  effectiveBpmTrackWhere,
  pendingBpmBackfillTrackWhere,
} from "./bpm";
import { resolveDbJobConcurrency, runWithConcurrency } from "./concurrency";
import { getDatabasePoolPressureSnapshot } from "./databaseErrors";
import { getEnrichmentJobStatuses } from "./enrichmentJobStatus";
import { getJobDebugSnapshot } from "./jobLock";
import { tracksWithGenresWhere, tracksWithPopularityWhere } from "./libraryHealth";
import { activeSyncStatusWhere } from "./syncStatus";

type CacheEntry = {
  expiresAt: number;
  promise: Promise<any>;
  settled: boolean;
};

const globalStatusCache = globalThis as typeof globalThis & {
  mixarrStatusCache?: Record<string, CacheEntry>;
};

const statusCache = globalStatusCache.mixarrStatusCache ?? {};
globalStatusCache.mixarrStatusCache = statusCache;

function positiveSeconds(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveStatusPollSeconds(active: boolean) {
  const activeSeconds = positiveSeconds(process.env.MIXARR_STATUS_POLL_SECONDS, 10);
  const idleSeconds = positiveSeconds(process.env.MIXARR_STATUS_IDLE_POLL_SECONDS, Math.max(30, activeSeconds * 3));
  return active ? activeSeconds : idleSeconds;
}

function statusCacheTtlMs() {
  return positiveSeconds(process.env.MIXARR_STATUS_CACHE_SECONDS, 5) * 1000;
}

export async function getSyncStatusPayload(userId: string, client: any = prisma) {
  const now = Date.now();
  const cached = statusCache[userId];
  if (cached && (!cached.settled || cached.expiresAt > now)) return cached.promise;

  const entry: CacheEntry = {
    expiresAt: now + statusCacheTtlMs(),
    settled: false,
    promise: buildSyncStatusPayload(userId, client).then((payload) => {
      entry.settled = true;
      entry.expiresAt = Date.now() + statusCacheTtlMs();
      return payload;
    }),
  };
  statusCache[userId] = entry;

  try {
    return await entry.promise;
  } catch (error) {
    if (statusCache[userId]?.promise === entry.promise) delete statusCache[userId];
    throw error;
  }
}

export async function buildSyncStatusPayload(userId: string, client: any = prisma) {
  const userTrackScope = {
    ...activeSyncStatusWhere(),
    library: {
      server: {
        userId,
      },
    },
  };

  const [user, libraries] = await runWithConcurrency<any>([
    () => client.user.findUnique({
      where: { id: userId },
      select: { defaultLibraryId: true },
    }),
    () => client.library.findMany({
      where: { server: { userId } },
      select: {
        id: true,
        name: true,
        server: { select: { name: true } },
        _count: { select: { tracks: { where: { syncStatus: "active" } } } },
      },
      orderBy: [
        { server: { name: "asc" } },
        { name: "asc" },
      ],
    }),
  ], resolveDbJobConcurrency());

  const [
    totalTracks,
    popularityWithData,
    popularityAttempted,
    audioFeaturesWithData,
    audioFeaturesAttempted,
    audioFeaturesApi,
    audioFeaturesLocal,
    audioFeaturesHeuristic,
    audioFeaturesPartial,
    audioFeaturesNoData,
    audioFeaturesFailed,
    audioFeaturesExtractionFailed,
    audioFeaturesAnalyzerFailed,
    audioFeaturesMissing,
    bpmWithData,
    bpmAttempted,
    bpmSuccess,
    bpmNoData,
    bpmFailed,
    bpmExtractionFailed,
    bpmAnalyzerFailed,
    bpmPendingBackfill,
    tagsWithData,
    tagsAttempted,
    metadataCorrupt,
    activeSyncs,
  ] = await runWithConcurrency<any>([
    () => client.track.count({ where: userTrackScope }),
    () => client.track.count({ where: { AND: [userTrackScope, tracksWithPopularityWhere()] } }),
    () => client.track.count({
      where: {
        AND: [
          userTrackScope,
          { OR: [{ popularity: { isNot: null } }, { popularityAttemptedAt: { not: null } }] },
        ],
      },
    }),
    () => client.audioFeature.count({ where: { track: { AND: [userTrackScope, completeAudioFeatureTrackWhere()] } } }),
    () => client.audioFeature.count({ where: { track: userTrackScope } }),
    () => client.track.count({ where: { AND: [userTrackScope, apiAudioFeatureTrackWhere()] } }),
    () => client.track.count({ where: { AND: [userTrackScope, localAudioFeatureTrackWhere()] } }),
    () => client.track.count({ where: { AND: [userTrackScope, heuristicAudioFeatureTrackWhere()] } }),
    () => client.track.count({ where: { AND: [userTrackScope, partialAudioFeatureTrackWhere()] } }),
    () => client.track.count({ where: { AND: [userTrackScope, audioFeatureNoDataTrackWhere()] } }),
    () => client.track.count({ where: { AND: [userTrackScope, audioFeatureFailedTrackWhere()] } }),
    () => client.track.count({ where: { AND: [userTrackScope, audioFeatureExtractionFailedTrackWhere()] } }),
    () => client.track.count({ where: { AND: [userTrackScope, audioFeatureAnalyzerFailedTrackWhere()] } }),
    () => client.track.count({ where: { AND: [userTrackScope, missingAudioFeatureTrackWhere()] } }),
    () => client.track.count({ where: { AND: [userTrackScope, effectiveBpmTrackWhere()] } }),
    () => client.track.count({ where: { AND: [userTrackScope, bpmAnalysisAttemptedTrackWhere()] } }),
    () => client.track.count({ where: { AND: [userTrackScope, bpmAnalysisAttemptedTrackWhere(), effectiveBpmTrackWhere()] } }),
    () => client.track.count({ where: { AND: [userTrackScope, bpmNoDataTrackWhere()] } }),
    () => client.track.count({ where: { AND: [userTrackScope, bpmFailedTrackWhere()] } }),
    () => client.track.count({ where: { AND: [userTrackScope, bpmExtractionFailedTrackWhere()] } }),
    () => client.track.count({ where: { AND: [userTrackScope, bpmAnalyzerFailedTrackWhere()] } }),
    () => client.track.count({ where: { AND: [userTrackScope, pendingBpmBackfillTrackWhere()] } }),
    () => client.track.count({ where: { AND: [userTrackScope, tracksWithGenresWhere()] } }),
    () => client.track.count({ where: { AND: [userTrackScope, { OR: [{ tagsSyncedAt: { not: null } }, { genreAttemptedAt: { not: null } }] }] } }),
    () => client.track.count({ where: { syncStatus: "metadata_corrupt", library: { server: { userId } } } }),
    () => client.syncLog.findMany({ where: { status: "in_progress", library: { server: { userId } } }, select: { id: true, startedAt: true, libraryId: true } }),
  ], resolveDbJobConcurrency());

  const initialLibrary =
    libraries.find((library: any) => library.id === user?.defaultLibraryId) ||
    libraries[0] ||
    null;
  const hasEmptyLibrary = libraries.length > 0 && totalTracks === 0;
  const libraryFingerprint = libraries
    .map((library: any) => `${library.id}:${library._count.tracks}`)
    .join("|");
  const initialLibraryPayload = initialLibrary
    ? {
        id: initialLibrary.id,
        name: initialLibrary.name,
        serverName: initialLibrary.server.name,
        trackCount: initialLibrary._count.tracks,
      }
    : null;
  const percentage = (processed: number) =>
    totalTracks > 0 ? Math.round((processed / totalTracks) * 100) : 0;
  const jobs = getEnrichmentJobStatuses();
  const jobDebug = getJobDebugSnapshot();
  const isSyncing = activeSyncs.length > 0 || Boolean(jobDebug.activeJob);

  return {
    pollSeconds: resolveStatusPollSeconds(isSyncing),
    popularity: {
      total: totalTracks,
      processed: popularityWithData,
      attempted: popularityAttempted,
      percentage: percentage(popularityWithData),
      isComplete: totalTracks > 0 && popularityWithData >= totalTracks,
      lastRun: jobs.popularity,
    },
    audioFeatures: {
      total: totalTracks,
      processed: audioFeaturesWithData,
      complete: audioFeaturesWithData,
      attempted: audioFeaturesAttempted,
      api: audioFeaturesApi,
      local: audioFeaturesLocal,
      heuristic: audioFeaturesHeuristic,
      partial: audioFeaturesPartial,
      noData: audioFeaturesNoData,
      failed: audioFeaturesFailed,
      extractionFailed: audioFeaturesExtractionFailed,
      analyzerFailed: audioFeaturesAnalyzerFailed,
      missing: audioFeaturesMissing,
      percentage: percentage(audioFeaturesWithData),
      isComplete: totalTracks > 0 && audioFeaturesWithData >= totalTracks,
      lastRun: jobs.audio,
    },
    bpm: {
      total: totalTracks,
      processed: bpmWithData,
      tracksWithBpm: bpmWithData,
      missing: Math.max(0, totalTracks - bpmWithData),
      attempted: bpmAttempted,
      success: bpmSuccess,
      noData: bpmNoData,
      failed: bpmFailed,
      extractionFailed: bpmExtractionFailed,
      analyzerFailed: bpmAnalyzerFailed,
      pendingBackfill: bpmPendingBackfill,
      percentage: percentage(bpmWithData),
      isComplete: totalTracks > 0 && bpmWithData >= totalTracks,
      lastRun: jobs.bpm,
    },
    tags: {
      total: totalTracks,
      processed: tagsWithData,
      attempted: tagsAttempted,
      percentage: percentage(tagsWithData),
      isComplete: totalTracks > 0 && tagsWithData >= totalTracks,
      lastRun: jobs.tags,
    },
    metadata: {
      isSyncing,
      hasEmptyLibrary,
      initialLibrary: initialLibraryPayload,
      libraryFingerprint,
      corruptTracks: metadataCorrupt,
    },
    debug: {
      jobs: jobDebug,
      database: getDatabasePoolPressureSnapshot(),
    },
  };
}

export function clearSyncStatusCacheForTests() {
  for (const key of Object.keys(statusCache)) delete statusCache[key];
}
