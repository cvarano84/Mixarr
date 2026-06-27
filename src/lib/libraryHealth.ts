import type { Prisma } from "@prisma/client";
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
  missingAudioFeatureTrackWhere,
  partialAudioFeatureTrackWhere,
} from "./audioFeatures";
import {
  bpmAnalyzerFailedTrackWhere,
  bpmExtractionFailedTrackWhere,
  bpmFailedTrackWhere,
  bpmNoDataTrackWhere,
  effectiveBpmTrackWhere,
  getEffectiveBpm,
  missingEffectiveBpmTrackWhere,
  pendingBpmBackfillTrackWhere,
} from "./bpm";

export const DEFAULT_CLEANUP_DAYS = 30;
export const MAX_MISSING_PAGE_SIZE = 100;
export const MAX_BPM_PAGE_SIZE = 100;
export const MAX_AUDIO_FEATURE_PAGE_SIZE = 100;
export const MAX_METADATA_PAGE_SIZE = 100;

const knownPopularityProviders = ["deezer", "lastfm", "spotify"] as const;
const unusableGenreNames = [
  "",
  "unknown",
  "none",
  "n/a",
  "na",
  "not found",
  "no data",
  "undefined",
  "null",
];

const usableGenreTagWhere = {
  type: "genre",
  name: { notIn: unusableGenreNames },
} satisfies Prisma.TagWhereInput;

export const bpmHealthFilters = [
  "tracks_with_bpm",
  "missing_bpm",
  "bpm_no_data",
  "bpm_failed",
  "extraction_failed",
  "analyzer_failed",
  "pending_backfill",
] as const;
export type BpmHealthFilter = typeof bpmHealthFilters[number];

export const audioFeatureHealthFilters = [
  "missing_audio_features",
  "api_audio_features",
  "local_audio_features",
  "heuristic_audio_features",
  "partial_audio_features",
  "audio_feature_no_data",
  "audio_feature_failed",
  "extraction_failed",
  "analyzer_failed",
] as const;
export type AudioFeatureHealthFilter = typeof audioFeatureHealthFilters[number];

export const genreHealthFilters = [
  "tracks_with_genres",
  "missing_genres",
  "genre_no_data",
  "genre_failed",
  "pending_genre_backfill",
] as const;
export type GenreHealthFilter = typeof genreHealthFilters[number];

export const popularityHealthFilters = [
  "tracks_with_popularity",
  "missing_popularity",
  "popularity_no_data",
  "popularity_failed",
  "pending_popularity_backfill",
] as const;
export type PopularityHealthFilter = typeof popularityHealthFilters[number];

export const metadataHealthSections = ["genres", "popularity"] as const;
export type MetadataHealthSection = typeof metadataHealthSections[number];
export type MetadataHealthFilter = GenreHealthFilter | PopularityHealthFilter;

export type LibraryHealthStatus = "healthy" | "warning" | "error";

export function determineLibraryHealthStatus(input: {
  lastSyncStatus?: string | null;
  snapshotComplete?: boolean | null;
  plexReportedTrackCount?: number | null;
  activeTrackCount: number;
  missingTrackCount: number;
  bpmFailureCount: number;
  lastSyncAt?: Date | string | null;
  now?: Date;
  staleAfterHours?: number;
}): LibraryHealthStatus {
  const now = input.now || new Date();
  const staleAfterHours = input.staleAfterHours || Number(process.env.LIBRARY_HEALTH_STALE_HOURS || 24);
  const lastSyncAt = input.lastSyncAt ? new Date(input.lastSyncAt) : null;
  const stale = !lastSyncAt || now.getTime() - lastSyncAt.getTime() > staleAfterHours * 3_600_000;
  const countMismatch = input.plexReportedTrackCount !== null
    && input.plexReportedTrackCount !== undefined
    && input.plexReportedTrackCount !== input.activeTrackCount;

  if (!input.lastSyncStatus || input.lastSyncStatus === "failed") return "error";
  if (input.lastSyncStatus === "success" && countMismatch) return "error";
  if (input.lastSyncStatus === "success" && input.snapshotComplete !== true) return "error";
  if (input.lastSyncStatus === "in_progress" && stale) return "error";
  if (input.lastSyncStatus !== "success") return "warning";
  if (input.missingTrackCount > 0 || input.bpmFailureCount > 0 || stale) return "warning";
  return "healthy";
}

export type MissingTrackFilters = {
  libraryId?: string;
  artist?: string;
  album?: string;
  search?: string;
  bpmStatus?: string;
  missingSinceFrom?: Date;
  missingSinceBefore?: Date;
};

export function isBpmHealthFilter(value: unknown): value is BpmHealthFilter {
  return typeof value === "string" && (bpmHealthFilters as readonly string[]).includes(value);
}

export function isAudioFeatureHealthFilter(value: unknown): value is AudioFeatureHealthFilter {
  return typeof value === "string" && (audioFeatureHealthFilters as readonly string[]).includes(value);
}

export function isGenreHealthFilter(value: unknown): value is GenreHealthFilter {
  return typeof value === "string" && (genreHealthFilters as readonly string[]).includes(value);
}

export function isPopularityHealthFilter(value: unknown): value is PopularityHealthFilter {
  return typeof value === "string" && (popularityHealthFilters as readonly string[]).includes(value);
}

export function isMetadataHealthSection(value: unknown): value is MetadataHealthSection {
  return typeof value === "string" && (metadataHealthSections as readonly string[]).includes(value);
}

export function bpmHealthFilterWhere(filter: BpmHealthFilter): Prisma.TrackWhereInput {
  switch (filter) {
    case "tracks_with_bpm": return effectiveBpmTrackWhere();
    case "missing_bpm": return missingEffectiveBpmTrackWhere();
    case "bpm_no_data": return bpmNoDataTrackWhere();
    case "bpm_failed": return bpmFailedTrackWhere();
    case "extraction_failed": return bpmExtractionFailedTrackWhere();
    case "analyzer_failed": return bpmAnalyzerFailedTrackWhere();
    case "pending_backfill": return pendingBpmBackfillTrackWhere();
  }
}

export function audioFeatureHealthFilterWhere(filter: AudioFeatureHealthFilter): Prisma.TrackWhereInput {
  switch (filter) {
    case "missing_audio_features": return missingAudioFeatureTrackWhere();
    case "api_audio_features": return apiAudioFeatureTrackWhere();
    case "local_audio_features": return localAudioFeatureTrackWhere();
    case "heuristic_audio_features": return heuristicAudioFeatureTrackWhere();
    case "partial_audio_features": return partialAudioFeatureTrackWhere();
    case "audio_feature_no_data": return audioFeatureNoDataTrackWhere();
    case "audio_feature_failed": return audioFeatureFailedTrackWhere();
    case "extraction_failed": return audioFeatureExtractionFailedTrackWhere();
    case "analyzer_failed": return audioFeatureAnalyzerFailedTrackWhere();
  }
}

export function tracksWithGenresWhere(): Prisma.TrackWhereInput {
  return { tags: { some: usableGenreTagWhere } };
}

export function missingGenresWhere(): Prisma.TrackWhereInput {
  return { tags: { none: usableGenreTagWhere } };
}

export function genreNoDataWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingGenresWhere(),
      {
        OR: [
          { genreStatus: "no_data" },
          { AND: [{ genreStatus: null }, { tagsSyncedAt: { not: null } }] },
        ],
      },
    ],
  };
}

export function genreFailedWhere(): Prisma.TrackWhereInput {
  return { AND: [missingGenresWhere(), { genreStatus: "failed" }] };
}

export function pendingGenreBackfillWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingGenresWhere(),
      {
        OR: [
          { genreStatus: { in: ["pending", "success"] } },
          { AND: [{ genreStatus: null }, { tagsSyncedAt: null }] },
        ],
      },
    ],
  };
}

export function tracksWithPopularityWhere(): Prisma.TrackWhereInput {
  return {
    popularity: {
      is: {
        provider: { in: [...knownPopularityProviders] },
        score: { gte: 0 },
      },
    },
  };
}

export function missingPopularityWhere(): Prisma.TrackWhereInput {
  return {
    OR: [
      { popularity: null },
      { popularity: { is: { provider: { notIn: [...knownPopularityProviders] } } } },
    ],
  };
}

export function popularityNoDataWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingPopularityWhere(),
      {
        OR: [
          { popularityStatus: "no_data" },
          { popularity: { is: { provider: "not_found" } } },
        ],
      },
    ],
  };
}

export function popularityFailedWhere(): Prisma.TrackWhereInput {
  return { AND: [missingPopularityWhere(), { popularityStatus: "failed" }] };
}

export function pendingPopularityBackfillWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingPopularityWhere(),
      {
        OR: [
          { popularityStatus: { in: ["pending", "success"] } },
          { AND: [{ popularityStatus: null }, { popularity: null }] },
          {
            AND: [
              { popularityStatus: null },
              { popularity: { is: { provider: { notIn: ["not_found", ...knownPopularityProviders] } } } },
            ],
          },
        ],
      },
    ],
  };
}

export function genreHealthFilterWhere(filter: GenreHealthFilter): Prisma.TrackWhereInput {
  switch (filter) {
    case "tracks_with_genres": return tracksWithGenresWhere();
    case "missing_genres": return missingGenresWhere();
    case "genre_no_data": return genreNoDataWhere();
    case "genre_failed": return genreFailedWhere();
    case "pending_genre_backfill": return pendingGenreBackfillWhere();
  }
}

export function popularityHealthFilterWhere(filter: PopularityHealthFilter): Prisma.TrackWhereInput {
  switch (filter) {
    case "tracks_with_popularity": return tracksWithPopularityWhere();
    case "missing_popularity": return missingPopularityWhere();
    case "popularity_no_data": return popularityNoDataWhere();
    case "popularity_failed": return popularityFailedWhere();
    case "pending_popularity_backfill": return pendingPopularityBackfillWhere();
  }
}

export function metadataHealthFilterWhere(section: MetadataHealthSection, filter: MetadataHealthFilter): Prisma.TrackWhereInput {
  if (section === "genres" && isGenreHealthFilter(filter)) return genreHealthFilterWhere(filter);
  if (section === "popularity" && isPopularityHealthFilter(filter)) return popularityHealthFilterWhere(filter);
  return { id: "__invalid__" };
}

export function buildBpmTrackWhere(userId: string, options: {
  filter: BpmHealthFilter;
  libraryId?: string;
  search?: string;
}): Prisma.TrackWhereInput {
  const and: Prisma.TrackWhereInput[] = [
    {
      syncStatus: "active",
      library: {
        ...(options.libraryId ? { id: options.libraryId } : {}),
        server: { userId },
      },
    },
    bpmHealthFilterWhere(options.filter),
  ];

  if (options.search) {
    and.push({ OR: [
      { title: { contains: options.search, mode: "insensitive" } },
      { artist: { title: { contains: options.search, mode: "insensitive" } } },
      { album: { title: { contains: options.search, mode: "insensitive" } } },
      { mediaPath: { contains: options.search, mode: "insensitive" } },
    ] });
  }
  return { AND: and };
}

export function buildAudioFeatureTrackWhere(userId: string, options: {
  filter: AudioFeatureHealthFilter;
  libraryId?: string;
  search?: string;
}): Prisma.TrackWhereInput {
  const and: Prisma.TrackWhereInput[] = [
    {
      syncStatus: "active",
      library: {
        ...(options.libraryId ? { id: options.libraryId } : {}),
        server: { userId },
      },
    },
    audioFeatureHealthFilterWhere(options.filter),
  ];

  if (options.search) {
    and.push({ OR: [
      { title: { contains: options.search, mode: "insensitive" } },
      { artist: { title: { contains: options.search, mode: "insensitive" } } },
      { album: { title: { contains: options.search, mode: "insensitive" } } },
      { mediaPath: { contains: options.search, mode: "insensitive" } },
    ] });
  }
  return { AND: and };
}

export function buildMetadataTrackWhere(userId: string, options: {
  section: MetadataHealthSection;
  filter: MetadataHealthFilter;
  libraryId?: string;
  search?: string;
}): Prisma.TrackWhereInput {
  const and: Prisma.TrackWhereInput[] = [
    {
      syncStatus: "active",
      library: {
        ...(options.libraryId ? { id: options.libraryId } : {}),
        server: { userId },
      },
    },
    metadataHealthFilterWhere(options.section, options.filter),
  ];

  if (options.search) {
    and.push({ OR: [
      { title: { contains: options.search, mode: "insensitive" } },
      { artist: { title: { contains: options.search, mode: "insensitive" } } },
      { album: { title: { contains: options.search, mode: "insensitive" } } },
      { mediaPath: { contains: options.search, mode: "insensitive" } },
      { ratingKey: { contains: options.search, mode: "insensitive" } },
    ] });
  }
  return { AND: and };
}

export async function getBpmHealthSummary(userId: string, libraryId?: string) {
  const active: Prisma.TrackWhereInput = {
    syncStatus: "active",
    library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } },
  };
  const [tracksWithBpm, missingBpm, bpmNoData, bpmFailed, extractionFailed, analyzerFailed, pendingBackfill] = await Promise.all([
    prisma.track.count({ where: { AND: [active, effectiveBpmTrackWhere()] } }),
    prisma.track.count({ where: { AND: [active, missingEffectiveBpmTrackWhere()] } }),
    prisma.track.count({ where: { AND: [active, bpmNoDataTrackWhere()] } }),
    prisma.track.count({ where: { AND: [active, bpmFailedTrackWhere()] } }),
    prisma.track.count({ where: { AND: [active, bpmExtractionFailedTrackWhere()] } }),
    prisma.track.count({ where: { AND: [active, bpmAnalyzerFailedTrackWhere()] } }),
    prisma.track.count({ where: { AND: [active, pendingBpmBackfillTrackWhere()] } }),
  ]);
  return { tracksWithBpm, missingBpm, bpmNoData, bpmFailed, extractionFailed, analyzerFailed, pendingBackfill };
}

export async function getGenreHealthSummary(userId: string, libraryId?: string) {
  const active: Prisma.TrackWhereInput = {
    syncStatus: "active",
    library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } },
  };
  const [tracksWithGenres, missingGenres, genreNoData, genreFailed, pendingGenreBackfill] = await Promise.all([
    prisma.track.count({ where: { AND: [active, tracksWithGenresWhere()] } }),
    prisma.track.count({ where: { AND: [active, missingGenresWhere()] } }),
    prisma.track.count({ where: { AND: [active, genreNoDataWhere()] } }),
    prisma.track.count({ where: { AND: [active, genreFailedWhere()] } }),
    prisma.track.count({ where: { AND: [active, pendingGenreBackfillWhere()] } }),
  ]);
  return { tracksWithGenres, missingGenres, genreNoData, genreFailed, pendingGenreBackfill };
}

export async function getPopularityHealthSummary(userId: string, libraryId?: string) {
  const active: Prisma.TrackWhereInput = {
    syncStatus: "active",
    library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } },
  };
  const [tracksWithPopularity, missingPopularity, popularityNoData, popularityFailed, pendingPopularityBackfill] = await Promise.all([
    prisma.track.count({ where: { AND: [active, tracksWithPopularityWhere()] } }),
    prisma.track.count({ where: { AND: [active, missingPopularityWhere()] } }),
    prisma.track.count({ where: { AND: [active, popularityNoDataWhere()] } }),
    prisma.track.count({ where: { AND: [active, popularityFailedWhere()] } }),
    prisma.track.count({ where: { AND: [active, pendingPopularityBackfillWhere()] } }),
  ]);
  return { tracksWithPopularity, missingPopularity, popularityNoData, popularityFailed, pendingPopularityBackfill };
}

export async function getMetadataHealthSummary(userId: string, section: MetadataHealthSection, libraryId?: string) {
  return section === "genres"
    ? getGenreHealthSummary(userId, libraryId)
    : getPopularityHealthSummary(userId, libraryId);
}

export async function getAudioFeatureHealthSummary(userId: string, libraryId?: string) {
  const active: Prisma.TrackWhereInput = {
    syncStatus: "active",
    library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } },
  };
  const [complete, missing, api, local, heuristic, partial, noData, failed, extractionFailed, analyzerFailed] = await Promise.all([
    prisma.track.count({ where: { AND: [active, completeAudioFeatureTrackWhere()] } }),
    prisma.track.count({ where: { AND: [active, missingAudioFeatureTrackWhere()] } }),
    prisma.track.count({ where: { AND: [active, apiAudioFeatureTrackWhere()] } }),
    prisma.track.count({ where: { AND: [active, localAudioFeatureTrackWhere()] } }),
    prisma.track.count({ where: { AND: [active, heuristicAudioFeatureTrackWhere()] } }),
    prisma.track.count({ where: { AND: [active, partialAudioFeatureTrackWhere()] } }),
    prisma.track.count({ where: { AND: [active, audioFeatureNoDataTrackWhere()] } }),
    prisma.track.count({ where: { AND: [active, audioFeatureFailedTrackWhere()] } }),
    prisma.track.count({ where: { AND: [active, audioFeatureExtractionFailedTrackWhere()] } }),
    prisma.track.count({ where: { AND: [active, audioFeatureAnalyzerFailedTrackWhere()] } }),
  ]);
  return { complete, missing, api, local, heuristic, partial, noData, failed, extractionFailed, analyzerFailed };
}

export function buildMissingTrackWhere(userId: string, filters: MissingTrackFilters = {}): Prisma.TrackWhereInput {
  const and: Prisma.TrackWhereInput[] = [{
    syncStatus: "missing",
    library: {
      ...(filters.libraryId ? { id: filters.libraryId } : {}),
      server: { userId },
    },
  }];

  if (filters.artist) and.push({ artist: { title: { contains: filters.artist, mode: "insensitive" } } });
  if (filters.album) and.push({ album: { title: { contains: filters.album, mode: "insensitive" } } });
  if (filters.search) {
    and.push({ OR: [
      { title: { contains: filters.search, mode: "insensitive" } },
      { mediaPath: { contains: filters.search, mode: "insensitive" } },
      { ratingKey: { contains: filters.search, mode: "insensitive" } },
    ] });
  }
  if (filters.missingSinceFrom || filters.missingSinceBefore) {
    and.push({ missingSince: {
      ...(filters.missingSinceFrom ? { gte: filters.missingSinceFrom } : {}),
      ...(filters.missingSinceBefore ? { lte: filters.missingSinceBefore } : {}),
    } });
  }

  if (filters.bpmStatus === "with_bpm") and.push(effectiveBpmTrackWhere());
  if (filters.bpmStatus === "no_data") and.push(bpmNoDataTrackWhere());
  if (filters.bpmStatus === "failed") and.push(bpmFailedTrackWhere());
  if (filters.bpmStatus === "extraction_failed") and.push(bpmExtractionFailedTrackWhere());
  if (filters.bpmStatus === "analyzer_failed") and.push(bpmAnalyzerFailedTrackWhere());
  if (filters.bpmStatus === "pending") and.push(pendingBpmBackfillTrackWhere());

  return { AND: and };
}

export function missingTrackBpmStatus(track: any) {
  if (getEffectiveBpm(track) !== null) return "with_bpm";
  const marker = track.bpmAnalysisStatus || track.audioFeature?.tempoSource;
  if (marker === "no_data" || marker === "local_not_found") return "no_data";
  if (marker === "extraction_failed" || marker === "local_extraction_failed") return "extraction_failed";
  if (marker === "analyzer_failed" || marker === "local_analyzer_failed") return "analyzer_failed";
  if (marker === "failed" || marker === "local_failed") return "failed";
  return "pending";
}

export async function getLibraryHealth(userId: string) {
  const libraries = await prisma.library.findMany({
    where: { type: "artist", server: { userId } },
    select: {
      id: true,
      name: true,
      plexId: true,
      server: { select: { id: true, name: true } },
      syncLogs: { orderBy: { startedAt: "desc" }, take: 1 },
    },
    orderBy: [{ server: { name: "asc" } }, { name: "asc" }],
  });

  return Promise.all(libraries.map(async (library) => {
    const active = { libraryId: library.id, syncStatus: "active" } as const;
    const [
      activeTracks, missingTracks, missingAlbums, missingArtists, tracksWithBpm,
      missingBpm, bpmNoData, bpmFailed, bpmExtractionFailed, bpmAnalyzerFailed, bpmPendingBackfill,
      audioFeaturesComplete, audioFeaturesMissing, audioFeaturesApi, audioFeaturesLocal,
      audioFeaturesHeuristic, audioFeaturesPartial, audioFeaturesNoData, audioFeaturesFailed,
      audioFeaturesExtractionFailed, audioFeaturesAnalyzerFailed,
      tracksWithGenres, missingGenres, genreNoData, genreFailed, pendingGenreBackfill,
      tracksWithPopularity, missingPopularity, popularityNoData, popularityFailed, pendingPopularityBackfill,
      lastReconciliation,
    ] = await Promise.all([
      prisma.track.count({ where: active }),
      prisma.track.count({ where: { libraryId: library.id, syncStatus: "missing" } }),
      prisma.album.count({ where: { libraryId: library.id, syncStatus: "missing" } }),
      prisma.artist.count({ where: { libraryId: library.id, syncStatus: "missing" } }),
      prisma.track.count({ where: { AND: [active, effectiveBpmTrackWhere()] } }),
      prisma.track.count({ where: { AND: [active, missingEffectiveBpmTrackWhere()] } }),
      prisma.track.count({ where: { AND: [active, bpmNoDataTrackWhere()] } }),
      prisma.track.count({ where: { AND: [active, bpmFailedTrackWhere()] } }),
      prisma.track.count({ where: { AND: [active, bpmExtractionFailedTrackWhere()] } }),
      prisma.track.count({ where: { AND: [active, bpmAnalyzerFailedTrackWhere()] } }),
      prisma.track.count({ where: { AND: [active, pendingBpmBackfillTrackWhere()] } }),
      prisma.track.count({ where: { AND: [active, completeAudioFeatureTrackWhere()] } }),
      prisma.track.count({ where: { AND: [active, missingAudioFeatureTrackWhere()] } }),
      prisma.track.count({ where: { AND: [active, apiAudioFeatureTrackWhere()] } }),
      prisma.track.count({ where: { AND: [active, localAudioFeatureTrackWhere()] } }),
      prisma.track.count({ where: { AND: [active, heuristicAudioFeatureTrackWhere()] } }),
      prisma.track.count({ where: { AND: [active, partialAudioFeatureTrackWhere()] } }),
      prisma.track.count({ where: { AND: [active, audioFeatureNoDataTrackWhere()] } }),
      prisma.track.count({ where: { AND: [active, audioFeatureFailedTrackWhere()] } }),
      prisma.track.count({ where: { AND: [active, audioFeatureExtractionFailedTrackWhere()] } }),
      prisma.track.count({ where: { AND: [active, audioFeatureAnalyzerFailedTrackWhere()] } }),
      prisma.track.count({ where: { AND: [active, tracksWithGenresWhere()] } }),
      prisma.track.count({ where: { AND: [active, missingGenresWhere()] } }),
      prisma.track.count({ where: { AND: [active, genreNoDataWhere()] } }),
      prisma.track.count({ where: { AND: [active, genreFailedWhere()] } }),
      prisma.track.count({ where: { AND: [active, pendingGenreBackfillWhere()] } }),
      prisma.track.count({ where: { AND: [active, tracksWithPopularityWhere()] } }),
      prisma.track.count({ where: { AND: [active, missingPopularityWhere()] } }),
      prisma.track.count({ where: { AND: [active, popularityNoDataWhere()] } }),
      prisma.track.count({ where: { AND: [active, popularityFailedWhere()] } }),
      prisma.track.count({ where: { AND: [active, pendingPopularityBackfillWhere()] } }),
      prisma.syncLog.findFirst({
        where: { libraryId: library.id, status: "success", snapshotComplete: true, reconciliationAt: { not: null } },
        orderBy: { reconciliationAt: "desc" },
      }),
    ]);
    const latest = library.syncLogs[0] || null;
    const plexReportedTrackCount = lastReconciliation?.plexReportedTrackCount ?? null;
    const difference = plexReportedTrackCount === null ? null : activeTracks - plexReportedTrackCount;
    const status = determineLibraryHealthStatus({
      lastSyncStatus: latest?.status,
      snapshotComplete: latest?.snapshotComplete,
      plexReportedTrackCount,
      activeTrackCount: activeTracks,
      missingTrackCount: missingTracks,
      bpmFailureCount: bpmFailed,
      lastSyncAt: latest?.endedAt || latest?.startedAt,
    });

    return {
      id: library.id,
      name: library.name,
      plexLibraryId: library.plexId,
      server: library.server,
      status,
      activeTracks,
      missingTracks,
      missingAlbums,
      missingArtists,
      tracksWithBpm,
      missingBpm,
      bpmNoData,
      bpmFailed,
      bpmExtractionFailed,
      bpmAnalyzerFailed,
      bpmPendingBackfill,
      audioFeaturesComplete,
      audioFeaturesMissing,
      audioFeaturesApi,
      audioFeaturesLocal,
      audioFeaturesHeuristic,
      audioFeaturesPartial,
      audioFeaturesNoData,
      audioFeaturesFailed,
      audioFeaturesExtractionFailed,
      audioFeaturesAnalyzerFailed,
      tracksWithGenres,
      missingGenres,
      genreNoData,
      genreFailed,
      pendingGenreBackfill,
      tracksWithPopularity,
      missingPopularity,
      popularityNoData,
      popularityFailed,
      pendingPopularityBackfill,
      lastFullSyncAt: latest?.endedAt || latest?.startedAt || null,
      lastReconciliationAt: lastReconciliation?.reconciliationAt || null,
      lastSyncStatus: latest?.status || "never",
      lastSyncRunId: latest?.id || null,
      lastSyncError: latest?.error || null,
      plexReportedTrackCount,
      mixarrActiveTrackCount: activeTracks,
      difference,
    };
  }));
}

export const missingTrackSelect = {
  id: true,
  title: true,
  ratingKey: true,
  mediaPath: true,
  lastSeenAt: true,
  missingSince: true,
  lastSeenSyncId: true,
  bpm: true,
  bpmAnalysisStatus: true,
  library: { select: { id: true, name: true } },
  artist: { select: { title: true } },
  album: { select: { title: true } },
  audioFeature: { select: { tempo: true, tempoSource: true } },
} satisfies Prisma.TrackSelect;

export const bpmHealthTrackSelect = {
  id: true,
  title: true,
  ratingKey: true,
  duration: true,
  mediaPath: true,
  bpm: true,
  bpmSource: true,
  bpmConfidence: true,
  bpmAnalysisStatus: true,
  bpmFailureReason: true,
  bpmAnalyzedAt: true,
  lastSeenAt: true,
  syncStatus: true,
  library: { select: { id: true, name: true } },
  artist: { select: { title: true } },
  album: { select: { title: true } },
  audioFeature: { select: { tempo: true, tempoSource: true, tempoConfidence: true } },
} satisfies Prisma.TrackSelect;

export const audioFeatureHealthTrackSelect = {
  id: true,
  title: true,
  ratingKey: true,
  duration: true,
  mediaPath: true,
  lastSeenAt: true,
  syncStatus: true,
  library: { select: { id: true, name: true } },
  artist: { select: { title: true } },
  album: { select: { title: true } },
  audioFeature: {
    select: {
      energy: true,
      valence: true,
      danceability: true,
      acousticness: true,
      tempo: true,
      audioFeatureSource: true,
      audioFeatureStatus: true,
      audioFeatureConfidence: true,
      audioFeatureFailureReason: true,
      audioFeatureAnalyzedAt: true,
      audioFeatureAnalysisScope: true,
      energySource: true,
      valenceSource: true,
      danceabilitySource: true,
      acousticnessSource: true,
    },
  },
} satisfies Prisma.TrackSelect;

export const metadataHealthTrackSelect = {
  id: true,
  title: true,
  ratingKey: true,
  duration: true,
  mediaPath: true,
  tagsSyncedAt: true,
  genreStatus: true,
  genreFailureReason: true,
  genreAttemptedAt: true,
  popularityStatus: true,
  popularityAttemptedAt: true,
  popularityFailureReason: true,
  lastSeenAt: true,
  syncStatus: true,
  library: { select: { id: true, name: true } },
  artist: { select: { title: true } },
  album: { select: { title: true } },
  tags: { where: usableGenreTagWhere, select: { name: true }, orderBy: { name: "asc" } },
  popularity: { select: { provider: true, score: true, confidence: true, lastUpdated: true } },
} satisfies Prisma.TrackSelect;

export function serializeBpmHealthTrack(track: any) {
  const effectiveBpm = getEffectiveBpm(track);
  return {
    id: track.id,
    title: track.title,
    artist: track.artist?.title || "Unknown artist",
    album: track.album?.title || "Unknown album",
    library: track.library,
    duration: track.duration,
    mediaPath: track.mediaPath,
    ratingKey: track.ratingKey,
    effectiveBpm,
    bpmSource: track.bpmSource || track.audioFeature?.tempoSource || null,
    bpmConfidence: track.bpmConfidence ?? track.audioFeature?.tempoConfidence ?? null,
    bpmAnalysisStatus: effectiveBpm !== null ? "success" : missingTrackBpmStatus(track),
    bpmFailureReason: track.bpmFailureReason,
    bpmAnalyzedAt: track.bpmAnalyzedAt,
    lastSeenAt: track.lastSeenAt,
    syncStatus: track.syncStatus,
  };
}

export function trackHasUsableGenres(track: any) {
  return Array.isArray(track.tags) && track.tags.some((tag: any) => {
    const name = typeof tag?.name === "string" ? tag.name.trim().toLowerCase() : "";
    return name.length > 0 && !unusableGenreNames.includes(name);
  });
}

export function trackHasValidPopularity(track: any) {
  const provider = track.popularity?.provider;
  return knownPopularityProviders.includes(provider)
    && typeof track.popularity?.score === "number"
    && Number.isFinite(track.popularity.score)
    && track.popularity.score >= 0;
}

export function metadataTrackStatus(section: MetadataHealthSection, track: any) {
  if (section === "genres") {
    if (trackHasUsableGenres(track)) return "success";
    if (track.genreStatus === "failed") return "failed";
    if (track.genreStatus === "no_data" || (!track.genreStatus && track.tagsSyncedAt)) return "no_data";
    return "pending";
  }

  if (trackHasValidPopularity(track)) return "success";
  if (track.popularityStatus === "failed") return "failed";
  if (track.popularityStatus === "no_data" || track.popularity?.provider === "not_found") return "no_data";
  return "pending";
}

export function serializeMetadataHealthTrack(track: any) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist?.title || "Unknown artist",
    album: track.album?.title || "Unknown album",
    library: track.library,
    duration: track.duration,
    mediaPath: track.mediaPath,
    ratingKey: track.ratingKey,
    genres: Array.isArray(track.tags) ? track.tags.map((tag: any) => tag.name).filter(Boolean) : [],
    genreStatus: metadataTrackStatus("genres", track),
    genreFailureReason: track.genreFailureReason || null,
    genreAttemptedAt: track.genreAttemptedAt || track.tagsSyncedAt || null,
    popularityScore: trackHasValidPopularity(track) ? track.popularity.score : null,
    popularitySource: trackHasValidPopularity(track) ? track.popularity.provider : null,
    popularityStatus: metadataTrackStatus("popularity", track),
    popularityFailureReason: track.popularityFailureReason || null,
    popularityAttemptedAt: track.popularityAttemptedAt || track.popularity?.lastUpdated || null,
    lastSeenAt: track.lastSeenAt,
    syncStatus: track.syncStatus,
  };
}

export function serializeAudioFeatureHealthTrack(track: any) {
  const feature = track.audioFeature;
  return {
    id: track.id,
    title: track.title,
    artist: track.artist?.title || "Unknown artist",
    album: track.album?.title || "Unknown album",
    library: track.library,
    duration: track.duration,
    mediaPath: track.mediaPath,
    ratingKey: track.ratingKey,
    energy: feature?.energy ?? null,
    mood: feature?.valence ?? null,
    bpm: feature?.tempo ?? null,
    danceability: feature?.danceability ?? null,
    acousticness: feature?.acousticness ?? null,
    source: feature?.audioFeatureSource || feature?.source || null,
    analysisScope: feature?.audioFeatureAnalysisScope || null,
    confidence: feature?.audioFeatureConfidence ?? feature?.confidence ?? null,
    status: feature?.audioFeatureStatus || (feature ? "partial" : "pending"),
    failureReason: feature?.audioFeatureFailureReason || null,
    analyzedAt: feature?.audioFeatureAnalyzedAt || null,
    fieldSources: {
      energy: feature?.energySource || null,
      mood: feature?.valenceSource || null,
      danceability: feature?.danceabilitySource || null,
      acousticness: feature?.acousticnessSource || null,
    },
    lastSeenAt: track.lastSeenAt,
    syncStatus: track.syncStatus,
  };
}

export function serializeMissingTrack(track: any) {
  return { ...track, bpmStatus: missingTrackBpmStatus(track) };
}

export function toCsv(rows: any[]) {
  const columns = [
    "Library", "Track title", "Artist", "Album", "Plex rating key", "Media path",
    "Last seen at", "Missing since", "Last sync run ID", "BPM status",
  ];
  const safeCell = (value: unknown) => {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [columns, ...rows.map((row) => [
    row.library.name, row.title, row.artist.title, row.album.title, row.ratingKey, row.mediaPath,
    row.lastSeenAt?.toISOString?.() || row.lastSeenAt, row.missingSince?.toISOString?.() || row.missingSince,
    row.lastSeenSyncId, missingTrackBpmStatus(row),
  ])].map((row) => row.map(safeCell).join(",")).join("\r\n");
}

export function metadataTracksToCsv(rows: any[]) {
  const columns = [
    "Library", "Track title", "Artist", "Album", "Plex rating key", "Media path",
    "Genres", "Genre status", "Genre failure reason", "Genre attempted at",
    "Popularity score", "Popularity source", "Popularity status", "Popularity failure reason",
    "Popularity attempted at", "Last seen at", "Sync status",
  ];
  const safeCell = (value: unknown) => {
    let text = value === null || value === undefined ? "" : Array.isArray(value) ? value.join("; ") : String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [columns, ...rows.map((row) => [
    row.library?.name,
    row.title,
    row.artist,
    row.album,
    row.ratingKey,
    row.mediaPath,
    row.genres,
    row.genreStatus,
    row.genreFailureReason,
    row.genreAttemptedAt,
    row.popularityScore,
    row.popularitySource,
    row.popularityStatus,
    row.popularityFailureReason,
    row.popularityAttemptedAt,
    row.lastSeenAt,
    row.syncStatus,
  ])].map((row) => row.map(safeCell).join(",")).join("\r\n");
}
