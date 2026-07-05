import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Prisma } from "@prisma/client";
import prisma from "./prisma";
import {
  emptyActiveTrackHealthBuckets,
  genreFailedWhere,
  genreNoDataWhere,
  getActiveTrackHealthBuckets,
  missingGenresWhere,
  missingPopularityWhere,
  pendingGenreBackfillWhere,
  pendingPopularityBackfillWhere,
  popularityFailedWhere,
  popularityNoDataWhere,
  tracksWithGenresWhere,
  tracksWithPopularityWhere,
  type ActiveTrackHealthBuckets,
} from "./libraryHealth";
import {
  bpmAnalyzerFailedTrackWhere,
  bpmExtractionFailedTrackWhere,
  bpmFailedTrackWhere,
  bpmNoDataTrackWhere,
  bpmTooShortTrackWhere,
  buildBpmSourceWhereClause,
  effectiveBpmTrackWhere,
  missingEffectiveBpmTrackWhere,
  pendingBpmBackfillTrackWhere,
} from "./bpm";
import {
  apiAudioFeatureTrackWhere,
  audioFeatureAnalyzerFailedTrackWhere,
  audioFeatureExtractionFailedTrackWhere,
  audioFeatureFailedTrackWhere,
  audioFeatureNoDataTrackWhere,
  audioFeatureTooShortTrackWhere,
  completeAudioFeatureTrackWhere,
  heuristicAudioFeatureTrackWhere,
  localAudioFeatureTrackWhere,
  missingAudioFeatureTrackWhere,
  partialAudioFeatureTrackWhere,
} from "./audioFeatures";

// This is the parity oracle from the fix plan. It seeds one library with tracks
// covering every health bucket plus the NULL edge cases, then computes each
// bucket the old way (a *Where() helper + prisma.track.count) and the new way
// (the single grouped getActiveTrackHealthBuckets scan) and asserts they match
// bucket-for-bucket. It needs a live Postgres, so it self-skips without one -
// point DATABASE_URL at a throwaway db (prisma db push) to run it.
const hasDatabase = Boolean(process.env.DATABASE_URL);

type TrackSpec = {
  key: string;
  track?: Partial<Prisma.TrackUncheckedCreateInput>;
  audioFeature?: Partial<Prisma.AudioFeatureUncheckedCreateInput> | null;
  popularity?: { provider: string; score: number } | null;
  genres?: string[];
  unusableGenres?: string[];
};

// A broad, deliberately adversarial spread. Exact bucket landings don't need to
// be correct here - the oracle only asserts old == new - but variety is what
// surfaces any NULL/predicate divergence between the SQL and Prisma.
const specs: TrackSpec[] = [
  // --- BPM sources ---
  { key: "bpm-imported", track: { bpm: 120 } },
  { key: "bpm-api-source", track: { apiBpm: 128, bpmSource: "api" } },
  { key: "bpm-api-deezer", track: { bpm: 130, bpmSource: "deezer", apiBpm: 130 } },
  { key: "bpm-local-column", track: { localBpm: 132 } },
  { key: "bpm-local-source", track: { bpm: 100, bpmSource: "local_essentia" } },
  { key: "bpm-local-af-essentia", audioFeature: { tempo: 140, tempoSource: "Essentia local" } },
  { key: "bpm-local-af-aubio", audioFeature: { tempo: 141, tempoSource: "Aubio 0.4" } },
  { key: "bpm-effective-only", track: { effectiveBpm: 118 } },
  // --- BPM missing / terminal markers ---
  { key: "bpm-no-data-status", track: { bpmAnalysisStatus: "no_data" } },
  { key: "bpm-failed-status", track: { bpmAnalysisStatus: "failed" } },
  { key: "bpm-extraction-status", track: { bpmAnalysisStatus: "extraction_failed" } },
  { key: "bpm-analyzer-status", track: { bpmAnalysisStatus: "analyzer_failed" } },
  { key: "bpm-too-short-status", track: { bpmAnalysisStatus: "too_short" } },
  { key: "bpm-no-data-af", audioFeature: { tempoSource: "local_not_found" } },
  { key: "bpm-extraction-af", audioFeature: { tempoSource: "local_extraction_failed" } },
  { key: "bpm-too-short-af", audioFeature: { tempoSource: "local_too_short" } },
  { key: "bpm-pending", track: { bpmAnalysisStatus: null } },
  { key: "bpm-pending-legacy-status", track: { bpmAnalysisStatus: "queued" } },
  // Adversarial NULL cases for the relation-branch flags: an af row exists but
  // tempoSource / tempo are NULL, so a naive COALESCE(..., false) would diverge
  // from Prisma's NULL-propagating `is {...} AND af exists` under negation.
  { key: "bpm-af-tempo-null-source", audioFeature: { tempo: 150 } },
  { key: "bpm-af-tempo-not-found-present", audioFeature: { tempo: 160, tempoSource: "local_not_found" } },
  { key: "bpm-af-tempo-source-null-pending", track: { bpmAnalysisStatus: "queued" }, audioFeature: { energy: 0.4 } },
  // --- Audio feature completeness ---
  {
    key: "af-complete-api",
    audioFeature: { apiEnergy: 0.6, apiMood: 0.7, apiDanceability: 0.4, apiAcousticness: 0.3, tempo: 120, audioFeatureSource: "api", audioFeatureStatus: "success" },
  },
  {
    key: "af-complete-local",
    audioFeature: { localEnergy: 0.6, localMood: 0.5, localDanceability: 0.4, localAcousticness: 0.3, tempo: 110, audioFeatureSource: "local_essentia", audioFeatureStatus: "success" },
  },
  {
    key: "af-complete-final",
    audioFeature: { energy: 0.6, valence: 0.6, danceability: 0.6, acousticness: 0.6, tempo: 100, source: "deezer" },
  },
  {
    key: "af-partial-status",
    audioFeature: { energy: 0.5, audioFeatureStatus: "partial" },
  },
  {
    key: "af-no-data",
    audioFeature: { energy: 0.4, audioFeatureStatus: "no_data" },
  },
  {
    key: "af-extraction-failed",
    audioFeature: { audioFeatureStatus: "extraction_failed" },
  },
  {
    key: "af-analyzer-failed",
    audioFeature: { audioFeatureStatus: "analyzer_failed" },
  },
  {
    key: "af-too-short",
    audioFeature: { audioFeatureStatus: "too_short" },
  },
  {
    key: "af-heuristic",
    audioFeature: { audioFeatureSource: "local_heuristic", localMood: 0.5, audioFeatureConfidence: 0.8, audioFeatureStatus: "success" },
  },
  {
    key: "af-placeholder",
    audioFeature: { energy: 0.5, valence: 0.5, danceability: 0.5, acousticness: 0.5, tempo: 120, source: "estimated" },
  },
  {
    // Adversarial: valid unit fields but NULL tempo and non-placeholder source,
    // so completeAudioFeatureWhere() evaluates to SQL NULL rather than FALSE.
    key: "af-null-tempo-complete-core-null",
    audioFeature: { energy: 0.6, valence: 0.6, danceability: 0.6, acousticness: 0.6, tempo: null, source: "deezer" },
  },
  {
    key: "af-out-of-range",
    audioFeature: { energy: 2, valence: 0.6, danceability: 0.6, acousticness: 0.6, tempo: 100, source: "deezer" },
  },
  { key: "af-missing-row", audioFeature: null },
  // --- Genres ---
  { key: "genre-usable", genres: ["rock"] },
  { key: "genre-usable-but-failed-status", genres: ["jazz"], track: { genreStatus: "failed" } },
  { key: "genre-unusable-no-data", unusableGenres: ["unknown"], track: { tagsSyncedAt: new Date() } },
  { key: "genre-failed", track: { genreStatus: "failed" } },
  { key: "genre-pending-status", track: { genreStatus: "pending" } },
  { key: "genre-pending-null", track: { genreStatus: null, tagsSyncedAt: null } },
  { key: "genre-no-data-null-status", track: { genreStatus: null, tagsSyncedAt: new Date() } },
  // --- Popularity ---
  { key: "pop-valid-spotify", popularity: { provider: "spotify", score: 50 } },
  { key: "pop-valid-deezer-zero", popularity: { provider: "deezer", score: 0 } },
  { key: "pop-not-found", popularity: { provider: "not_found", score: 0 }, track: { popularityStatus: "no_data" } },
  { key: "pop-failed", track: { popularityStatus: "failed" } },
  { key: "pop-pending-status", track: { popularityStatus: "pending" } },
  { key: "pop-pending-null", track: { popularityStatus: null } },
  { key: "pop-other-provider", popularity: { provider: "musicbrainz", score: 10 }, track: { popularityStatus: null } },
  // --- Excluded from active buckets ---
  { key: "excluded-missing", track: { syncStatus: "missing", bpm: 120 } },
];

async function seedLibrary(): Promise<string> {
  await prisma.user.deleteMany({ where: { username: { startsWith: "parity-" } } });
  const stamp = Date.now();
  // User.plexId is a 32-bit Int, so keep the synthetic (negative, to dodge real
  // Plex ids) value inside INT4 range.
  const syntheticPlexId = -(Math.floor(Math.random() * 2_000_000_000) + 1);
  const user = await prisma.user.create({
    data: { plexId: syntheticPlexId, username: `parity-${stamp}`, accessToken: "x" },
  });
  const server = await prisma.server.create({
    data: { machineIdentifier: `parity-${stamp}`, name: "Parity", uri: "http://localhost", accessToken: "x", userId: user.id },
  });
  const library = await prisma.library.create({
    data: { plexId: `parity-${stamp}`, serverId: server.id, name: "Parity", type: "artist" },
  });
  const artist = await prisma.artist.create({
    data: { plexId: `artist-${stamp}`, libraryId: library.id, title: "Parity Artist" },
  });
  const album = await prisma.album.create({
    data: { plexId: `album-${stamp}`, libraryId: library.id, artistId: artist.id, title: "Parity Album" },
  });

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const tags = [
      ...(spec.genres ?? []).map((name) => ({ type: "genre", name })),
      ...(spec.unusableGenres ?? []).map((name) => ({ type: "genre", name })),
    ];
    await prisma.track.create({
      data: {
        plexId: `track-${stamp}-${i}`,
        ratingKey: `rk-${stamp}-${i}`,
        libraryId: library.id,
        albumId: album.id,
        artistId: artist.id,
        title: spec.key,
        ...spec.track,
        ...(spec.audioFeature ? { audioFeature: { create: spec.audioFeature } } : {}),
        ...(spec.popularity ? { popularity: { create: spec.popularity } } : {}),
        ...(tags.length
          ? {
              tags: {
                connectOrCreate: tags.map((tag) => ({
                  where: { type_name: { type: tag.type, name: tag.name } },
                  create: tag,
                })),
              },
            }
          : {}),
      },
    });
  }

  return library.id;
}

describe("library health parity", { skip: hasDatabase ? false : "set DATABASE_URL to run the parity oracle" }, () => {
  let libraryId = "";

  before(async () => {
    libraryId = await seedLibrary();
  });

  after(async () => {
    if (!libraryId) return;
    const library = await prisma.library.findUnique({ where: { id: libraryId }, select: { server: { select: { userId: true } } } });
    if (library?.server.userId) {
      await prisma.user.delete({ where: { id: library.server.userId } });
    }
    await prisma.tag.deleteMany({ where: { type: "genre", name: { in: ["rock", "jazz", "unknown"] } } });
  });

  it("matches every active-track bucket against the Prisma *Where() helpers", async () => {
    const active: Prisma.TrackWhereInput = { libraryId, syncStatus: "active" };
    const count = (where: Prisma.TrackWhereInput) => prisma.track.count({ where: { AND: [active, where] } });

    const oldBuckets: ActiveTrackHealthBuckets = {
      activeTracks: await prisma.track.count({ where: active }),
      tracksWithBpm: await count(effectiveBpmTrackWhere()),
      bpmApi: await count(buildBpmSourceWhereClause("api_bpm")),
      bpmLocal: await count(buildBpmSourceWhereClause("local_bpm")),
      bpmImported: await count(buildBpmSourceWhereClause("imported_bpm")),
      missingBpm: await count(missingEffectiveBpmTrackWhere()),
      bpmNoData: await count(bpmNoDataTrackWhere()),
      bpmFailed: await count(bpmFailedTrackWhere()),
      bpmExtractionFailed: await count(bpmExtractionFailedTrackWhere()),
      bpmAnalyzerFailed: await count(bpmAnalyzerFailedTrackWhere()),
      bpmTooShort: await count(bpmTooShortTrackWhere()),
      bpmPendingBackfill: await count(pendingBpmBackfillTrackWhere()),
      audioFeaturesComplete: await count(completeAudioFeatureTrackWhere()),
      audioFeaturesMissing: await count(missingAudioFeatureTrackWhere()),
      audioFeaturesApi: await count(apiAudioFeatureTrackWhere()),
      audioFeaturesLocal: await count(localAudioFeatureTrackWhere()),
      audioFeaturesHeuristic: await count(heuristicAudioFeatureTrackWhere()),
      audioFeaturesPartial: await count(partialAudioFeatureTrackWhere()),
      audioFeaturesNoData: await count(audioFeatureNoDataTrackWhere()),
      audioFeaturesFailed: await count(audioFeatureFailedTrackWhere()),
      audioFeaturesExtractionFailed: await count(audioFeatureExtractionFailedTrackWhere()),
      audioFeaturesAnalyzerFailed: await count(audioFeatureAnalyzerFailedTrackWhere()),
      audioFeaturesTooShort: await count(audioFeatureTooShortTrackWhere()),
      tracksWithGenres: await count(tracksWithGenresWhere()),
      missingGenres: await count(missingGenresWhere()),
      genreNoData: await count(genreNoDataWhere()),
      genreFailed: await count(genreFailedWhere()),
      pendingGenreBackfill: await count(pendingGenreBackfillWhere()),
      tracksWithPopularity: await count(tracksWithPopularityWhere()),
      missingPopularity: await count(missingPopularityWhere()),
      popularityNoData: await count(popularityNoDataWhere()),
      popularityFailed: await count(popularityFailedWhere()),
      pendingPopularityBackfill: await count(pendingPopularityBackfillWhere()),
    };

    const grouped = await getActiveTrackHealthBuckets([libraryId]);
    const newBuckets = grouped.get(libraryId) ?? emptyActiveTrackHealthBuckets();

    for (const key of Object.keys(oldBuckets) as Array<keyof ActiveTrackHealthBuckets>) {
      assert.equal(newBuckets[key], oldBuckets[key], `bucket ${key}: grouped=${newBuckets[key]} prisma=${oldBuckets[key]}`);
    }

    // Sanity: the seed must actually exercise the buckets, otherwise a bug that
    // zeroes everything would pass vacuously.
    assert.ok(oldBuckets.activeTracks >= specs.length - 1, "expected active tracks seeded");
    assert.ok(oldBuckets.tracksWithBpm > 0 && oldBuckets.missingBpm > 0, "expected both bpm present and missing");
    assert.ok(oldBuckets.audioFeaturesComplete > 0 && oldBuckets.audioFeaturesMissing > 0, "expected af complete and missing");
    assert.ok(oldBuckets.tracksWithGenres > 0 && oldBuckets.missingGenres > 0, "expected genres present and missing");
    assert.ok(oldBuckets.tracksWithPopularity > 0 && oldBuckets.missingPopularity > 0, "expected popularity present and missing");
  });

  it("returns empty buckets for an unknown library id without querying rows", async () => {
    const grouped = await getActiveTrackHealthBuckets([]);
    assert.equal(grouped.size, 0);
  });
});
