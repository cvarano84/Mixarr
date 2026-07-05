import { Prisma } from "@prisma/client";
import prisma from "./prisma";
import {
  apiAudioFeatureTrackWhere,
  audioFeatureAnalyzerFailedTrackWhere,
  audioFeatureExtractionFailedTrackWhere,
  audioFeatureFailedTrackWhere,
  audioFeatureNoDataTrackWhere,
  audioFeatureTooShortTrackWhere,
  completeAudioFeatureTrackWhere,
  getEffectiveAudioFeatures,
  heuristicAudioFeatureTrackWhere,
  localAudioFeatureTrackWhere,
  missingAudioFeatureTrackWhere,
  partialAudioFeatureTrackWhere,
} from "./audioFeatures";
import {
  apiBpmTrackWhere,
  bpmAnalyzerFailedTrackWhere,
  bpmExtractionFailedTrackWhere,
  bpmFailedTrackWhere,
  bpmNoDataTrackWhere,
  bpmRetryEligibilityTrackWhere,
  bpmTooShortTrackWhere,
  buildBpmSourceWhereClause,
  effectiveBpmTrackWhere,
  getEffectiveBpm,
  importedBpmTrackWhere,
  localBpmSourceTrackWhere,
  missingEffectiveBpmTrackWhere,
  pendingBpmBackfillTrackWhere,
  type BpmRetryProviderMode,
} from "./bpm";
import { getUserSyncSettings, metadataProviderModeLabel, resolveMetadataProviderSettings } from "./syncSettings";

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
  "api_bpm",
  "local_bpm",
  "imported_bpm",
  "missing_bpm",
  "bpm_no_data",
  "bpm_failed",
  "extraction_failed",
  "analyzer_failed",
  "too_short",
  "pending_backfill",
  "pending_bpm",
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
  "too_short",
  "pending_audio_features",
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
    case "api_bpm": return buildBpmSourceWhereClause("api_bpm");
    case "local_bpm": return buildBpmSourceWhereClause("local_bpm");
    case "imported_bpm": return buildBpmSourceWhereClause("imported_bpm");
    case "missing_bpm": return missingEffectiveBpmTrackWhere();
    case "bpm_no_data": return bpmNoDataTrackWhere();
    case "bpm_failed": return bpmFailedTrackWhere();
    case "extraction_failed": return bpmExtractionFailedTrackWhere();
    case "analyzer_failed": return bpmAnalyzerFailedTrackWhere();
    case "too_short": return bpmTooShortTrackWhere();
    case "pending_backfill": return pendingBpmBackfillTrackWhere();
    case "pending_bpm": return pendingBpmBackfillTrackWhere();
  }
}

export function bpmHealthFilterClassification(filter: BpmHealthFilter) {
  switch (filter) {
    case "api_bpm": return "source=api_bpm";
    case "local_bpm": return "source=local_bpm";
    case "imported_bpm": return "source=imported_bpm";
    case "tracks_with_bpm": return "source=any_bpm";
    case "missing_bpm": return "source=missing_bpm";
    case "bpm_no_data": return "status=no_data";
    case "bpm_failed": return "status=failed";
    case "extraction_failed": return "status=extraction_failed";
    case "analyzer_failed": return "status=analyzer_failed";
    case "too_short": return "status=too_short";
    case "pending_backfill":
    case "pending_bpm":
      return "status=pending";
  }
}

export function buildBpmRetryBaseWhere(userId: string, options: {
  filter: BpmHealthFilter;
  libraryId?: string;
  trackIds?: string[];
}): Prisma.TrackWhereInput {
  const targetWhere = options.trackIds?.length
    ? { id: { in: options.trackIds } }
    : bpmHealthFilterWhere(options.filter);

  return {
    AND: [
      {
        syncStatus: "active",
        library: { ...(options.libraryId ? { id: options.libraryId } : {}), server: { userId } },
      },
      targetWhere,
    ],
  };
}

export function buildBpmRetryCandidateWhere(userId: string, options: {
  filter: BpmHealthFilter;
  libraryId?: string;
  trackIds?: string[];
  force?: boolean;
  providerMode?: BpmRetryProviderMode;
}): Prisma.TrackWhereInput {
  return {
    AND: [
      buildBpmRetryBaseWhere(userId, options),
      bpmRetryEligibilityTrackWhere({
        force: options.force,
        providerMode: options.providerMode,
        filter: options.filter,
      }),
    ],
  };
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
    case "too_short": return audioFeatureTooShortTrackWhere();
    case "pending_audio_features": return missingAudioFeatureTrackWhere();
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
  const [tracksWithBpm, apiBpm, localBpm, importedBpm, missingBpm, bpmNoData, bpmFailed, extractionFailed, analyzerFailed, tooShort, pendingBackfill] = await Promise.all([
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("tracks_with_bpm")] } }),
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("api_bpm")] } }),
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("local_bpm")] } }),
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("imported_bpm")] } }),
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("missing_bpm")] } }),
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("bpm_no_data")] } }),
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("bpm_failed")] } }),
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("extraction_failed")] } }),
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("analyzer_failed")] } }),
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("too_short")] } }),
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("pending_bpm")] } }),
  ]);
  return { tracksWithBpm, apiBpm, localBpm, importedBpm, missingBpm, bpmNoData, bpmFailed, extractionFailed, analyzerFailed, tooShort, pendingBackfill };
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
  const [complete, missing, api, local, heuristic, partial, noData, failed, extractionFailed, analyzerFailed, tooShort] = await Promise.all([
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
    prisma.track.count({ where: { AND: [active, audioFeatureTooShortTrackWhere()] } }),
  ]);
  return { complete, missing, api, local, heuristic, partial, noData, failed, extractionFailed, analyzerFailed, tooShort };
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
  if (filters.bpmStatus === "too_short") and.push(bpmTooShortTrackWhere());
  if (filters.bpmStatus === "pending") and.push(pendingBpmBackfillTrackWhere());

  return { AND: and };
}

export function missingTrackBpmStatus(track: any) {
  if (getEffectiveBpm(track) !== null) return "with_bpm";
  const marker = track.bpmAnalysisStatus || track.audioFeature?.tempoSource;
  if (marker === "no_data" || marker === "local_not_found") return "no_data";
  if (marker === "extraction_failed" || marker === "local_extraction_failed") return "extraction_failed";
  if (marker === "analyzer_failed" || marker === "local_analyzer_failed") return "analyzer_failed";
  if (marker === "too_short" || marker === "local_too_short") return "too_short";
  if (marker === "failed" || marker === "local_failed") return "failed";
  return "pending";
}

// The per-library, per-track health buckets that used to be ~35 separate
// prisma.track.count() anti-join queries. We now compute all of them in one
// grouped scan per library (see getActiveTrackHealthBuckets). The keys mirror
// the fields getLibraryHealth returns, so nothing downstream has to change.
export type ActiveTrackHealthBuckets = {
  activeTracks: number;
  tracksWithBpm: number;
  bpmApi: number;
  bpmLocal: number;
  bpmImported: number;
  missingBpm: number;
  bpmNoData: number;
  bpmFailed: number;
  bpmExtractionFailed: number;
  bpmAnalyzerFailed: number;
  bpmTooShort: number;
  bpmPendingBackfill: number;
  audioFeaturesComplete: number;
  audioFeaturesMissing: number;
  audioFeaturesApi: number;
  audioFeaturesLocal: number;
  audioFeaturesHeuristic: number;
  audioFeaturesPartial: number;
  audioFeaturesNoData: number;
  audioFeaturesFailed: number;
  audioFeaturesExtractionFailed: number;
  audioFeaturesAnalyzerFailed: number;
  audioFeaturesTooShort: number;
  tracksWithGenres: number;
  missingGenres: number;
  genreNoData: number;
  genreFailed: number;
  pendingGenreBackfill: number;
  tracksWithPopularity: number;
  missingPopularity: number;
  popularityNoData: number;
  popularityFailed: number;
  pendingPopularityBackfill: number;
};

export function emptyActiveTrackHealthBuckets(): ActiveTrackHealthBuckets {
  return {
    activeTracks: 0, tracksWithBpm: 0, bpmApi: 0, bpmLocal: 0, bpmImported: 0, missingBpm: 0,
    bpmNoData: 0, bpmFailed: 0, bpmExtractionFailed: 0, bpmAnalyzerFailed: 0, bpmTooShort: 0, bpmPendingBackfill: 0,
    audioFeaturesComplete: 0, audioFeaturesMissing: 0, audioFeaturesApi: 0, audioFeaturesLocal: 0,
    audioFeaturesHeuristic: 0, audioFeaturesPartial: 0, audioFeaturesNoData: 0, audioFeaturesFailed: 0,
    audioFeaturesExtractionFailed: 0, audioFeaturesAnalyzerFailed: 0, audioFeaturesTooShort: 0,
    tracksWithGenres: 0, missingGenres: 0, genreNoData: 0, genreFailed: 0, pendingGenreBackfill: 0,
    tracksWithPopularity: 0, missingPopularity: 0, popularityNoData: 0, popularityFailed: 0, pendingPopularityBackfill: 0,
  };
}

// One grouped scan of the active tracks in the given libraries, producing every
// health bucket at once. Each boolean flag below is a verbatim port of the
// matching *Where() helper; the parity oracle in libraryHealthParity.test.ts
// proves, bucket-for-bucket, that these SQL predicates match the Prisma ones.
//
// Two rules keep the port faithful to Prisma's NULL semantics:
//   1. Track column comparisons are written as-is, so `col = 'x'` is NULL for a
//      NULL column exactly like Prisma's, which matters under NOT.
//   2. Relation predicates (audioFeature/popularity `is`, tags `some`/`none`)
//      are made total - EXISTS for genres, COALESCE(..., false) for the 1:1
//      joins - because Prisma compiles them to IN/EXISTS subqueries that are
//      never NULL. That is the swap that also kills the pathological anti-joins.
export async function getActiveTrackHealthBuckets(libraryIds: string[]): Promise<Map<string, ActiveTrackHealthBuckets>> {
  const buckets = new Map<string, ActiveTrackHealthBuckets>();
  if (libraryIds.length === 0) return buckets;

  const knownProviders = Prisma.join([...knownPopularityProviders]);
  const knownProvidersWithNotFound = Prisma.join(["not_found", ...knownPopularityProviders]);
  const unusableGenres = Prisma.join([...unusableGenreNames]);
  const libraries = Prisma.join(libraryIds);

  // The ~130 count() FILTER aggregates push this query's estimated cost past
  // jit_above_cost, so Postgres JIT-compiles it (~1.7s on a 35k-track library)
  // on every dashboard load while the actual scan is ~0.3s. SET LOCAL scopes the
  // opt-out to this one transaction, so we skip the compile without touching the
  // database's global jit settings. The generous timeout keeps a cold, very
  // large library from tripping the interactive-transaction default (5s).
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL jit = off`;
    return tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    WITH base AS (
      SELECT
        t."libraryId"               AS "libraryId",
        t."bpm"                     AS bpm,
        t."effectiveBpm"            AS effective_bpm,
        t."apiBpm"                  AS api_bpm,
        t."localBpm"                AS local_bpm,
        t."bpmSource"               AS bpm_source,
        t."bpmAnalysisStatus"       AS bpm_analysis_status,
        t."genreStatus"             AS genre_status,
        t."tagsSyncedAt"            AS tags_synced_at,
        t."popularityStatus"        AS popularity_status,
        af."trackId"                AS af_track_id,
        af."tempo"                  AS af_tempo,
        af."tempoSource"            AS af_tempo_source,
        af."energy"                 AS af_energy,
        af."valence"                AS af_valence,
        af."danceability"           AS af_danceability,
        af."acousticness"           AS af_acousticness,
        af."apiEnergy"              AS af_api_energy,
        af."apiMood"                AS af_api_mood,
        af."apiDanceability"        AS af_api_danceability,
        af."apiAcousticness"        AS af_api_acousticness,
        af."localEnergy"            AS af_local_energy,
        af."localMood"              AS af_local_mood,
        af."localDanceability"      AS af_local_danceability,
        af."localAcousticness"      AS af_local_acousticness,
        af."source"                 AS af_source,
        af."audioFeatureSource"     AS af_source_kind,
        af."audioFeatureStatus"     AS af_status,
        af."audioFeatureConfidence" AS af_confidence,
        af."energySource"           AS af_energy_source,
        af."valenceSource"          AS af_valence_source,
        af."danceabilitySource"     AS af_danceability_source,
        af."acousticnessSource"     AS af_acousticness_source,
        p."trackId"                 AS pop_track_id,
        p."provider"                AS pop_provider,
        p."score"                   AS pop_score,
        g.has_usable_genre          AS has_usable_genre
      FROM "Track" t
      LEFT JOIN "AudioFeature" af ON af."trackId" = t."id"
      LEFT JOIN "Popularity" p ON p."trackId" = t."id"
      LEFT JOIN LATERAL (
        SELECT EXISTS (
          SELECT 1
          FROM "_TrackTags" tt
          JOIN "Tag" gg ON gg."id" = tt."A"
          WHERE tt."B" = t."id"
            AND gg."type" = 'genre'
            AND gg."name" NOT IN (${unusableGenres})
        ) AS has_usable_genre
      ) g ON true
      WHERE t."syncStatus" = 'active'
        AND t."libraryId" IN (${libraries})
    ),
    core AS (
      SELECT
        "libraryId",
        af_track_id,
        af_status,
        genre_status,
        tags_synced_at,
        popularity_status,
        pop_track_id,
        pop_provider,
        pop_score,
        has_usable_genre,
        -- missingEffectiveBpmTrackWhere() (total; effectiveBpmTrackWhere is its complement)
        ((bpm IS NULL OR bpm <= 0)
          AND (effective_bpm IS NULL OR effective_bpm <= 0)
          AND (api_bpm IS NULL OR api_bpm <= 0)
          AND (local_bpm IS NULL OR local_bpm <= 0)
          AND (af_tempo IS NULL OR af_tempo <= 0)) AS missing_effective_bpm,
        -- localBpmSuccessSourceWhere(). The relation branch mirrors Prisma's
        -- audioFeature-is compilation: (predicate) AND af row exists, which
        -- keeps NULL semantics intact when this flag is later negated.
        (local_bpm > 0
          OR bpm_source IN ('local_essentia', 'essentia', 'aubio')
          OR (bpm_analysis_status = 'success' AND bpm_source IN ('local_essentia', 'essentia', 'aubio'))
          OR (((af_tempo > 0 AND af_tempo_source LIKE 'Essentia%') OR (af_tempo > 0 AND af_tempo_source LIKE 'Aubio%')) AND af_track_id IS NOT NULL)) AS bpm_local_success,
        -- apiBpmSourceWhere() inner OR (apiBpm>0 OR bpmSource in api/deezer)
        (api_bpm > 0 OR bpm_source IN ('api', 'deezer')) AS bpm_api_core,
        -- bpm terminal markers: bpmAnalysisStatus column OR (tempoSource on an existing af row)
        (bpm_analysis_status = 'no_data' OR (af_tempo_source = 'local_not_found' AND af_track_id IS NOT NULL)) AS bpm_marker_no_data,
        (bpm_analysis_status = 'failed' OR (af_tempo_source = 'local_failed' AND af_track_id IS NOT NULL)) AS bpm_marker_failed,
        (bpm_analysis_status = 'extraction_failed' OR (af_tempo_source = 'local_extraction_failed' AND af_track_id IS NOT NULL)) AS bpm_marker_extraction,
        (bpm_analysis_status = 'analyzer_failed' OR (af_tempo_source = 'local_analyzer_failed' AND af_track_id IS NOT NULL)) AS bpm_marker_analyzer,
        (bpm_analysis_status = 'too_short' OR (af_tempo_source = 'local_too_short' AND af_track_id IS NOT NULL)) AS bpm_marker_too_short,
        -- pendingBpmBackfillTrackWhere(): status is null or non-terminal (bpmAnalysisStatuses)
        (bpm_analysis_status IS NULL
          OR bpm_analysis_status NOT IN ('success', 'no_data', 'failed', 'extraction_failed', 'analyzer_failed', 'too_short')) AS bpm_status_pending,
        -- completeAudioFeatureWhere() on the joined af row (nullable on purpose)
        (
          (af_status IS NULL OR af_status NOT IN ('pending', 'no_data', 'extraction_failed', 'analyzer_failed', 'too_short'))
          AND (
            (
              (af_local_energy >= 0 AND af_local_energy <= 1
                AND af_local_mood >= 0 AND af_local_mood <= 1
                AND af_local_danceability >= 0 AND af_local_danceability <= 1
                AND af_local_acousticness >= 0 AND af_local_acousticness <= 1
                AND af_tempo > 0)
              AND (af_source_kind IN ('local_essentia', 'mixed')
                OR af_energy_source = 'local_essentia' OR af_valence_source = 'local_essentia'
                OR af_danceability_source = 'local_essentia' OR af_acousticness_source = 'local_essentia'
                OR af_local_energy IS NOT NULL OR af_local_mood IS NOT NULL
                OR af_local_danceability IS NOT NULL OR af_local_acousticness IS NOT NULL)
            )
            OR (
              (af_api_energy >= 0 AND af_api_energy <= 1
                AND af_api_mood >= 0 AND af_api_mood <= 1
                AND af_api_danceability >= 0 AND af_api_danceability <= 1
                AND af_api_acousticness >= 0 AND af_api_acousticness <= 1
                AND af_tempo > 0)
              AND (af_source_kind IN ('api', 'mixed')
                OR af_energy_source = 'api' OR af_valence_source = 'api'
                OR af_danceability_source = 'api' OR af_acousticness_source = 'api'
                OR af_api_energy IS NOT NULL OR af_api_mood IS NOT NULL
                OR af_api_danceability IS NOT NULL OR af_api_acousticness IS NOT NULL)
              AND NOT (af_source IN ('not_found', 'estimated', 'Deezer BPM only')
                OR (af_source_kind = 'local_heuristic' AND af_confidence <= 0)
                OR (af_energy = 0.5 AND af_valence = 0.5 AND af_danceability = 0.5
                  AND (af_source ILIKE '%Unknown Mood%' OR af_source = 'estimated' OR af_status = 'no_data')))
            )
            OR (
              (af_energy >= 0 AND af_energy <= 1
                AND af_valence >= 0 AND af_valence <= 1
                AND af_danceability >= 0 AND af_danceability <= 1
                AND af_acousticness >= 0 AND af_acousticness <= 1
                AND af_tempo > 0)
              AND NOT (af_source IN ('not_found', 'estimated', 'Deezer BPM only')
                OR (af_source_kind = 'local_heuristic' AND af_confidence <= 0)
                OR (af_energy = 0.5 AND af_valence = 0.5 AND af_danceability = 0.5
                  AND (af_source ILIKE '%Unknown Mood%' OR af_source = 'estimated' OR af_status = 'no_data')))
            )
          )
        ) AS complete_core,
        -- apiAudioFeatureTrackWhere() source OR
        (af_source_kind = 'api'
          OR af_api_energy IS NOT NULL OR af_api_mood IS NOT NULL
          OR af_api_danceability IS NOT NULL OR af_api_acousticness IS NOT NULL
          OR (af_source_kind IS NULL AND af_source NOT IN ('not_found', 'estimated', 'local_not_found'))) AS af_api_marker,
        -- localAudioFeatureTrackWhere() source OR
        (af_local_energy IS NOT NULL OR af_local_mood IS NOT NULL
          OR af_local_danceability IS NOT NULL OR af_local_acousticness IS NOT NULL
          OR af_source_kind IN ('local_essentia', 'mixed')) AS af_local_marker,
        -- heuristicAudioFeatureTrackWhere(): af row must exist
        (af_track_id IS NOT NULL AND (
          af_source_kind = 'local_heuristic'
          OR af_valence_source = 'local_heuristic'
          OR af_acousticness_source = 'local_heuristic'
          OR af_danceability_source = 'local_heuristic'
          OR af_local_mood IS NOT NULL OR af_local_danceability IS NOT NULL OR af_local_acousticness IS NOT NULL)) AS af_heuristic_present,
        -- partialAudioFeatureTrackWhere() inner OR: af row must exist
        (af_track_id IS NOT NULL AND (
          af_status = 'partial'
          OR af_energy IS NOT NULL OR af_valence IS NOT NULL OR af_danceability IS NOT NULL OR af_acousticness IS NOT NULL OR af_tempo IS NOT NULL
          OR af_local_energy IS NOT NULL OR af_local_mood IS NOT NULL OR af_local_danceability IS NOT NULL OR af_local_acousticness IS NOT NULL
          OR af_api_energy IS NOT NULL OR af_api_mood IS NOT NULL OR af_api_danceability IS NOT NULL OR af_api_acousticness IS NOT NULL)) AS af_partial_present
      FROM base
    ),
    flags AS (
      SELECT
        "libraryId",
        missing_effective_bpm,
        bpm_local_success,
        bpm_api_core,
        bpm_marker_no_data,
        bpm_marker_failed,
        bpm_marker_extraction,
        bpm_marker_analyzer,
        bpm_marker_too_short,
        bpm_status_pending,
        af_status,
        af_api_marker,
        af_local_marker,
        af_heuristic_present,
        af_partial_present,
        genre_status,
        tags_synced_at,
        has_usable_genre,
        popularity_status,
        pop_track_id,
        pop_provider,
        pop_score,
        af_track_id,
        -- completeAudioFeatureWhere() on the af row, kept nullable so that the
        -- outer NOT in the partial bucket propagates NULL exactly like Prisma's
        -- LEFT JOIN compilation of NOT (audioFeature is complete) does.
        complete_core
      FROM core
    )
    SELECT
      "libraryId",
      count(*)                                                                                   AS active_tracks,
      count(*) FILTER (WHERE NOT missing_effective_bpm)                                          AS tracks_with_bpm,
      count(*) FILTER (WHERE NOT missing_effective_bpm AND NOT bpm_local_success AND bpm_api_core) AS bpm_api,
      count(*) FILTER (WHERE NOT missing_effective_bpm AND bpm_local_success)                    AS bpm_local,
      count(*) FILTER (WHERE NOT missing_effective_bpm AND NOT bpm_local_success AND NOT bpm_api_core) AS bpm_imported,
      count(*) FILTER (WHERE missing_effective_bpm)                                              AS missing_bpm,
      count(*) FILTER (WHERE missing_effective_bpm AND bpm_marker_no_data)                       AS bpm_no_data,
      count(*) FILTER (WHERE missing_effective_bpm AND (bpm_marker_failed OR bpm_marker_extraction OR bpm_marker_analyzer)) AS bpm_failed,
      count(*) FILTER (WHERE missing_effective_bpm AND bpm_marker_extraction)                    AS bpm_extraction_failed,
      count(*) FILTER (WHERE missing_effective_bpm AND bpm_marker_analyzer)                      AS bpm_analyzer_failed,
      count(*) FILTER (WHERE missing_effective_bpm AND bpm_marker_too_short)                     AS bpm_too_short,
      count(*) FILTER (WHERE missing_effective_bpm AND bpm_status_pending
        AND NOT bpm_marker_no_data AND NOT bpm_marker_failed AND NOT bpm_marker_extraction
        AND NOT bpm_marker_analyzer AND NOT bpm_marker_too_short)                                AS bpm_pending_backfill,
      -- audioFeature { is: complete }  ->  (complete_core) AND af row exists
      count(*) FILTER (WHERE complete_core AND af_track_id IS NOT NULL)                          AS af_complete,
      -- missingAudioFeatureTrackWhere() = OR[ af null, af is (NOT complete) ]
      count(*) FILTER (WHERE af_track_id IS NULL OR (NOT complete_core AND af_track_id IS NOT NULL)) AS af_missing,
      count(*) FILTER (WHERE (complete_core AND af_api_marker) AND af_track_id IS NOT NULL)      AS af_api,
      count(*) FILTER (WHERE (complete_core AND af_local_marker) AND af_track_id IS NOT NULL)    AS af_local,
      count(*) FILTER (WHERE af_heuristic_present)                                               AS af_heuristic,
      -- partial uses the OUTER NOT: NOT (audioFeature is complete), NULL-propagating
      count(*) FILTER (WHERE af_partial_present AND NOT (complete_core AND af_track_id IS NOT NULL)) AS af_partial,
      count(*) FILTER (WHERE (NOT complete_core AND af_track_id IS NOT NULL) AND af_status = 'no_data') AS af_no_data,
      count(*) FILTER (WHERE (NOT complete_core AND af_track_id IS NOT NULL) AND (af_status = 'extraction_failed' OR af_status = 'analyzer_failed')) AS af_failed,
      count(*) FILTER (WHERE (NOT complete_core AND af_track_id IS NOT NULL) AND af_status = 'extraction_failed') AS af_extraction_failed,
      count(*) FILTER (WHERE (NOT complete_core AND af_track_id IS NOT NULL) AND af_status = 'analyzer_failed') AS af_analyzer_failed,
      count(*) FILTER (WHERE (NOT complete_core AND af_track_id IS NOT NULL) AND af_status = 'too_short') AS af_too_short,
      count(*) FILTER (WHERE has_usable_genre)                                                   AS tracks_with_genres,
      count(*) FILTER (WHERE NOT has_usable_genre)                                               AS missing_genres,
      count(*) FILTER (WHERE NOT has_usable_genre AND (genre_status = 'no_data' OR (genre_status IS NULL AND tags_synced_at IS NOT NULL))) AS genre_no_data,
      count(*) FILTER (WHERE NOT has_usable_genre AND genre_status = 'failed')                   AS genre_failed,
      count(*) FILTER (WHERE NOT has_usable_genre AND (genre_status IN ('pending', 'success') OR (genre_status IS NULL AND tags_synced_at IS NULL))) AS pending_genre_backfill,
      count(*) FILTER (WHERE pop_track_id IS NOT NULL AND pop_provider IN (${knownProviders}) AND pop_score >= 0) AS tracks_with_popularity,
      count(*) FILTER (WHERE pop_track_id IS NULL OR pop_provider NOT IN (${knownProviders}))    AS missing_popularity,
      count(*) FILTER (WHERE (pop_track_id IS NULL OR pop_provider NOT IN (${knownProviders}))
        AND (popularity_status = 'no_data' OR pop_provider = 'not_found'))                       AS popularity_no_data,
      count(*) FILTER (WHERE (pop_track_id IS NULL OR pop_provider NOT IN (${knownProviders}))
        AND popularity_status = 'failed')                                                        AS popularity_failed,
      count(*) FILTER (WHERE (pop_track_id IS NULL OR pop_provider NOT IN (${knownProviders}))
        AND (popularity_status IN ('pending', 'success')
          OR (popularity_status IS NULL AND pop_track_id IS NULL)
          OR (popularity_status IS NULL AND pop_track_id IS NOT NULL AND pop_provider NOT IN (${knownProvidersWithNotFound})))) AS pending_popularity_backfill
    FROM flags
    GROUP BY "libraryId"
  `);
  }, { timeout: 30_000 });

  for (const row of rows) {
    buckets.set(String(row.libraryId), {
      activeTracks: Number(row.active_tracks),
      tracksWithBpm: Number(row.tracks_with_bpm),
      bpmApi: Number(row.bpm_api),
      bpmLocal: Number(row.bpm_local),
      bpmImported: Number(row.bpm_imported),
      missingBpm: Number(row.missing_bpm),
      bpmNoData: Number(row.bpm_no_data),
      bpmFailed: Number(row.bpm_failed),
      bpmExtractionFailed: Number(row.bpm_extraction_failed),
      bpmAnalyzerFailed: Number(row.bpm_analyzer_failed),
      bpmTooShort: Number(row.bpm_too_short),
      bpmPendingBackfill: Number(row.bpm_pending_backfill),
      audioFeaturesComplete: Number(row.af_complete),
      audioFeaturesMissing: Number(row.af_missing),
      audioFeaturesApi: Number(row.af_api),
      audioFeaturesLocal: Number(row.af_local),
      audioFeaturesHeuristic: Number(row.af_heuristic),
      audioFeaturesPartial: Number(row.af_partial),
      audioFeaturesNoData: Number(row.af_no_data),
      audioFeaturesFailed: Number(row.af_failed),
      audioFeaturesExtractionFailed: Number(row.af_extraction_failed),
      audioFeaturesAnalyzerFailed: Number(row.af_analyzer_failed),
      audioFeaturesTooShort: Number(row.af_too_short),
      tracksWithGenres: Number(row.tracks_with_genres),
      missingGenres: Number(row.missing_genres),
      genreNoData: Number(row.genre_no_data),
      genreFailed: Number(row.genre_failed),
      pendingGenreBackfill: Number(row.pending_genre_backfill),
      tracksWithPopularity: Number(row.tracks_with_popularity),
      missingPopularity: Number(row.missing_popularity),
      popularityNoData: Number(row.popularity_no_data),
      popularityFailed: Number(row.popularity_failed),
      pendingPopularityBackfill: Number(row.pending_popularity_backfill),
    });
  }

  return buckets;
}

export async function getLibraryHealth(userId: string) {
  const metadataSettings = resolveMetadataProviderSettings(await getUserSyncSettings(userId));
  const bpmProviderMode = metadataProviderModeLabel(metadataSettings.bpm);
  const audioFeatureProviderMode = metadataProviderModeLabel(metadataSettings.audioFeatures);
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

  // One grouped scan replaces the ~35 per-library anti-join counts we used to
  // fire per library. Missing-record counts and the reconciliation lookup stay
  // as their own cheap indexed queries - they never hit the pathological plan.
  const bucketsByLibrary = await getActiveTrackHealthBuckets(libraries.map((library) => library.id));

  return Promise.all(libraries.map(async (library) => {
    const buckets = bucketsByLibrary.get(library.id) ?? emptyActiveTrackHealthBuckets();
    const [missingTracks, missingAlbums, missingArtists, lastReconciliation] = await Promise.all([
      prisma.track.count({ where: { libraryId: library.id, syncStatus: "missing" } }),
      prisma.album.count({ where: { libraryId: library.id, syncStatus: "missing" } }),
      prisma.artist.count({ where: { libraryId: library.id, syncStatus: "missing" } }),
      prisma.syncLog.findFirst({
        where: { libraryId: library.id, status: "success", snapshotComplete: true, reconciliationAt: { not: null } },
        orderBy: { reconciliationAt: "desc" },
      }),
    ]);
    const activeTracks = buckets.activeTracks;
    const latest = library.syncLogs[0] || null;
    const plexReportedTrackCount = lastReconciliation?.plexReportedTrackCount ?? null;
    const difference = plexReportedTrackCount === null ? null : activeTracks - plexReportedTrackCount;
    const status = determineLibraryHealthStatus({
      lastSyncStatus: latest?.status,
      snapshotComplete: latest?.snapshotComplete,
      plexReportedTrackCount,
      activeTrackCount: activeTracks,
      missingTrackCount: missingTracks,
      bpmFailureCount: buckets.bpmFailed,
      lastSyncAt: latest?.endedAt || latest?.startedAt,
    });

    return {
      id: library.id,
      name: library.name,
      plexLibraryId: library.plexId,
      server: library.server,
      status,
      ...buckets,
      missingTracks,
      missingAlbums,
      missingArtists,
      bpmProviderMode,
      audioFeatureProviderMode,
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
  apiBpm: true,
  localBpm: true,
  effectiveBpm: true,
  bpmSource: true,
  bpmConfidence: true,
  bpmAnalysisStatus: true,
  bpmAnalysisScope: true,
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
      apiEnergy: true,
      apiMood: true,
      apiDanceability: true,
      apiAcousticness: true,
      apiLoudness: true,
      localEnergy: true,
      localMood: true,
      localDanceability: true,
      localAcousticness: true,
      localLoudness: true,
      effectiveEnergy: true,
      effectiveMood: true,
      effectiveDanceability: true,
      effectiveAcousticness: true,
      tempo: true,
      loudness: true,
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
    apiBpm: track.apiBpm ?? null,
    localBpm: track.localBpm ?? null,
    bpmSource: track.bpmSource || track.audioFeature?.tempoSource || null,
    bpmConfidence: track.bpmConfidence ?? track.audioFeature?.tempoConfidence ?? null,
    bpmAnalysisScope: track.bpmAnalysisScope || null,
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
  const effective = getEffectiveAudioFeatures(track, { preferLocalAudioFeatures: true, allowEstimated: true });
  return {
    id: track.id,
    title: track.title,
    artist: track.artist?.title || "Unknown artist",
    album: track.album?.title || "Unknown album",
    library: track.library,
    duration: track.duration,
    mediaPath: track.mediaPath,
    ratingKey: track.ratingKey,
    energy: effective.energy,
    mood: effective.mood,
    bpm: effective.tempo,
    danceability: effective.danceability,
    acousticness: effective.acousticness,
    api: {
      energy: feature?.apiEnergy ?? null,
      mood: feature?.apiMood ?? null,
      danceability: feature?.apiDanceability ?? null,
      acousticness: feature?.apiAcousticness ?? null,
      loudness: feature?.apiLoudness ?? null,
    },
    local: {
      energy: feature?.localEnergy ?? null,
      mood: feature?.localMood ?? null,
      danceability: feature?.localDanceability ?? null,
      acousticness: feature?.localAcousticness ?? null,
      loudness: feature?.localLoudness ?? null,
    },
    source: effective.source || feature?.source || null,
    analysisScope: feature?.audioFeatureAnalysisScope || null,
    confidence: feature?.audioFeatureConfidence ?? feature?.confidence ?? null,
    status: effective.complete ? "success" : feature?.audioFeatureStatus || (feature ? "partial" : "pending"),
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

export function audioFeatureMissingFields(track: any) {
  return getEffectiveAudioFeatures(track, {
    preferLocalAudioFeatures: true,
    allowEstimated: true,
  }).missingFields;
}

export async function logPartialAudioFeatureRetryResult(options: {
  userId: string;
  libraryId?: string;
  before: number;
  processed: number;
  failed: number;
}) {
  const active: Prisma.TrackWhereInput = {
    syncStatus: "active",
    library: {
      ...(options.libraryId ? { id: options.libraryId } : {}),
      server: { userId: options.userId },
    },
  };
  const where: Prisma.TrackWhereInput = {
    AND: [active, partialAudioFeatureTrackWhere()],
  };
  const [remaining, tracks] = await Promise.all([
    prisma.track.count({ where }),
    prisma.track.findMany({
      where,
      select: audioFeatureHealthTrackSelect,
      orderBy: [{ artist: { title: "asc" } }, { album: { title: "asc" } }, { title: "asc" }],
      take: 10,
    }),
  ]);

  console.log(
    `[LibraryHealth] partial_audio_features after retry: before=${options.before} processed=${options.processed} failed=${options.failed} remaining=${remaining}`,
  );
  for (const track of tracks) {
    console.log(
      `[LibraryHealth] Remaining partial: ratingKey=${track.ratingKey} artist=${JSON.stringify(track.artist?.title || "Unknown artist")} title=${JSON.stringify(track.title)} missing=${JSON.stringify(audioFeatureMissingFields(track))}`,
    );
  }
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
