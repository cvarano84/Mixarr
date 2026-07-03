import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "fs/promises";
import path from "path";
import { bpmFailedTrackWhere, pendingBpmBackfillTrackWhere } from "./bpm";
import {
  buildBpmTrackWhere,
  buildMetadataTrackWhere,
  buildMissingTrackWhere,
  determineLibraryHealthStatus,
  metadataTrackStatus,
  missingPopularityWhere,
  missingTrackBpmStatus,
  pendingGenreBackfillWhere,
  popularityNoDataWhere,
  toCsv,
  tracksWithPopularityWhere,
} from "./libraryHealth";

describe("library health", () => {
  const now = new Date("2026-06-22T12:00:00Z");

  it("is healthy only after a complete, matching, recent sync", () => {
    assert.equal(determineLibraryHealthStatus({
      lastSyncStatus: "success",
      snapshotComplete: true,
      plexReportedTrackCount: 33_137,
      activeTrackCount: 33_137,
      missingTrackCount: 0,
      bpmFailureCount: 0,
      lastSyncAt: "2026-06-22T11:00:00Z",
      now,
    }), "healthy");
  });

  it("warns for missing records or BPM failures without hiding sync integrity", () => {
    assert.equal(determineLibraryHealthStatus({
      lastSyncStatus: "success",
      snapshotComplete: true,
      plexReportedTrackCount: 33_137,
      activeTrackCount: 33_137,
      missingTrackCount: 41,
      bpmFailureCount: 0,
      lastSyncAt: "2026-06-22T11:00:00Z",
      now,
    }), "warning");
  });

  it("reports failed, partial, interrupted, and mismatched syncs as errors", () => {
    const base = { activeTrackCount: 10, missingTrackCount: 0, bpmFailureCount: 0, lastSyncAt: now, now };
    assert.equal(determineLibraryHealthStatus({ ...base, lastSyncStatus: "failed" }), "error");
    assert.equal(determineLibraryHealthStatus({ ...base, lastSyncStatus: "success", snapshotComplete: false }), "error");
    assert.equal(determineLibraryHealthStatus({ ...base, lastSyncStatus: "success", snapshotComplete: true, plexReportedTrackCount: 11 }), "error");
    assert.equal(determineLibraryHealthStatus({ ...base, lastSyncStatus: "in_progress", lastSyncAt: "2026-06-20T00:00:00Z" }), "error");
    assert.equal(determineLibraryHealthStatus({ ...base, lastSyncStatus: "in_progress", plexReportedTrackCount: 11 }), "warning");
  });

  it("always scopes missing queries to the signed-in user's missing tracks", () => {
    const where = buildMissingTrackWhere("user-a", { libraryId: "library-a", search: "song" }) as any;
    assert.equal(where.AND[0].syncStatus, "missing");
    assert.equal(where.AND[0].library.id, "library-a");
    assert.equal(where.AND[0].library.server.userId, "user-a");
  });

  it("always scopes BPM health queries to the signed-in user's active tracks", () => {
    const where = buildBpmTrackWhere("user-a", { filter: "missing_bpm", libraryId: "library-a", search: "song" }) as any;
    assert.equal(where.AND[0].syncStatus, "active");
    assert.equal(where.AND[0].library.id, "library-a");
    assert.equal(where.AND[0].library.server.userId, "user-a");
    assert.match(JSON.stringify(where.AND[2]), /artist/);
    assert.match(JSON.stringify(where.AND[2]), /album/);
    assert.match(JSON.stringify(where.AND[2]), /mediaPath/);
  });

  it("always scopes metadata health queries to active tracks and searchable metadata fields", () => {
    const where = buildMetadataTrackWhere("user-a", { section: "genres", filter: "missing_genres", libraryId: "library-a", search: "rating-42" }) as any;
    assert.equal(where.AND[0].syncStatus, "active");
    assert.equal(where.AND[0].library.id, "library-a");
    assert.equal(where.AND[0].library.server.userId, "user-a");
    assert.match(JSON.stringify(where.AND[2]), /artist/);
    assert.match(JSON.stringify(where.AND[2]), /album/);
    assert.match(JSON.stringify(where.AND[2]), /mediaPath/);
    assert.match(JSON.stringify(where.AND[2]), /ratingKey/);
  });

  it("does not count placeholder popularity rows as completed metadata", () => {
    const valid = JSON.stringify(tracksWithPopularityWhere());
    assert.match(valid, /deezer/);
    assert.match(valid, /spotify/);
    assert.doesNotMatch(valid, /not_found/);

    const missing = JSON.stringify(missingPopularityWhere());
    assert.match(missing, /notIn/);

    const noData = JSON.stringify(popularityNoDataWhere());
    assert.match(noData, /not_found/);
  });

  it("keeps pending genre backfill separate from terminal no-data and failed states", () => {
    const pending = JSON.stringify(pendingGenreBackfillWhere());
    assert.match(pending, /pending/);
    assert.match(pending, /tagsSyncedAt/);
    assert.doesNotMatch(pending, /no_data/);
  });

  it("treats BPM failed as the umbrella for every terminal failure", () => {
    const failed = JSON.stringify(bpmFailedTrackWhere());
    assert.match(failed, /\"failed\"/);
    assert.match(failed, /extraction_failed/);
    assert.match(failed, /analyzer_failed/);
    assert.doesNotMatch(failed, /too_short/);

    const pending = JSON.stringify(pendingBpmBackfillTrackWhere());
    assert.match(pending, /notIn/);
    assert.match(pending, /no_data/);
    assert.match(pending, /too_short/);
  });

  it("escapes spreadsheet formulas and quotes in CSV exports", () => {
    const csv = toCsv([{
      library: { name: "Music" }, title: "=cmd", artist: { title: 'A "Band"' }, album: { title: "Album" },
      ratingKey: "42", mediaPath: "/music/song.flac", lastSeenAt: null, missingSince: null,
      lastSeenSyncId: "sync-1", bpmAnalysisStatus: "no_data", audioFeature: null,
    }]);
    assert.match(csv, /"'=cmd"/);
    assert.match(csv, /"A ""Band"""/);
  });

  it("exposes analyzer failures separately from extraction failures", () => {
    assert.equal(missingTrackBpmStatus({ bpm: null, bpmAnalysisStatus: "analyzer_failed" }), "analyzer_failed");
    assert.equal(missingTrackBpmStatus({ bpm: null, bpmAnalysisStatus: "extraction_failed" }), "extraction_failed");
    assert.equal(missingTrackBpmStatus({ bpm: null, bpmAnalysisStatus: "too_short" }), "too_short");
  });

  it("serializes legacy metadata attempt markers into health statuses", () => {
    assert.equal(metadataTrackStatus("genres", { tags: [], genreStatus: null, tagsSyncedAt: new Date() }), "no_data");
    assert.equal(metadataTrackStatus("popularity", { popularityStatus: null, popularity: { provider: "not_found" } }), "no_data");
    assert.equal(metadataTrackStatus("popularity", { popularityStatus: null, popularity: { provider: "spotify", score: 0 } }), "success");
  });

  it("revalidates Library Health after audio-feature retry queueing and completion", async () => {
    const retryRoute = await readFile(path.join(process.cwd(), "src/app/api/settings/library-health/audio-feature-retry/route.ts"), "utf8");
    const syncStartRoute = await readFile(path.join(process.cwd(), "src/app/api/sync/start/route.ts"), "utf8");

    assert.match(retryRoute, /revalidatePath\("\/settings\/library-health"\)/);
    assert.match(syncStartRoute, /logPartialAudioFeatureRetryResult/);
    assert.match(syncStartRoute, /revalidatePath\("\/settings\/library-health"\)/);
  });
});
