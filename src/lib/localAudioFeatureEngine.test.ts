import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "fs/promises";
import path from "path";
import {
  localAudioFeatureWhere,
  needsLocalAudioFeatureBackfill,
  normalizeAudioFeatureAnalysisScope,
  runLocalAudioFeatureEngine,
} from "./localAudioFeatureEngine";
import { acquireJobLock, resetJobLocksForTests } from "./jobLock";

describe("LocalAudioFeatureEngine analysis scope", () => {
  it("defaults missing or invalid LOCAL_AUDIO_FEATURES_SCOPE values to windows", () => {
    assert.equal(normalizeAudioFeatureAnalysisScope(undefined), "windows");
    assert.equal(normalizeAudioFeatureAnalysisScope(""), "windows");
    assert.equal(normalizeAudioFeatureAnalysisScope("bad-value"), "windows");
    assert.equal(normalizeAudioFeatureAnalysisScope("windows"), "windows");
    assert.equal(normalizeAudioFeatureAnalysisScope("whole_track"), "whole_track");
  });

  it("uses Essentia algorithms that do not require classifier models", async () => {
    const source = await readFile(path.join(process.cwd(), "src/lib/localAudioFeatureEngine.ts"), "utf8");
    assert.match(source, /RhythmExtractor2013/);
    assert.doesNotMatch(source, /MusicExtractorSVM/);
    assert.match(source, /audioFeatureAnalysisScope/);
  });
});

describe("LocalAudioFeatureEngine backfill predicates", () => {
  it("does not need backfill after valid local Essentia features were persisted", () => {
    const track = {
      syncStatus: "active",
      audioFeature: {
        energy: 0.72,
        valence: 0.43,
        danceability: 0.66,
        acousticness: 0.22,
        tempo: null,
        source: "Essentia local audio analysis",
        audioFeatureSource: "local_essentia",
        audioFeatureStatus: "partial",
        audioFeatureConfidence: 0.81,
        audioFeatureAnalyzedAt: new Date(),
        energySource: "local_essentia",
        valenceSource: "local_heuristic",
        danceabilitySource: "local_essentia",
        acousticnessSource: "local_heuristic",
      },
    };

    assert.equal(needsLocalAudioFeatureBackfill(track), false);
  });

  it("does not reprocess local no-data or failed attempts until retry/reset", () => {
    for (const status of ["no_data", "extraction_failed", "analyzer_failed"]) {
      assert.equal(needsLocalAudioFeatureBackfill({
        syncStatus: "active",
        audioFeature: {
          audioFeatureSource: status === "no_data" ? "local_heuristic" : "local_essentia",
          audioFeatureStatus: status,
          audioFeatureConfidence: 0,
          audioFeatureAnalyzedAt: new Date(),
        },
      }), false);
    }
  });

  it("still backfills tracks with missing final features and no local attempt", () => {
    assert.equal(needsLocalAudioFeatureBackfill({ syncStatus: "active", audioFeature: null }), true);
    assert.equal(needsLocalAudioFeatureBackfill({
      syncStatus: "active",
      audioFeature: {
        energy: null,
        valence: null,
        danceability: null,
        tempo: null,
        source: "not_found",
        audioFeatureSource: null,
        audioFeatureStatus: "no_data",
        audioFeatureAnalyzedAt: new Date(),
      },
    }), true);
  });

  it("uses local-attempt exclusion in the missing query so restarts resume remaining tracks", () => {
    const where = JSON.stringify(localAudioFeatureWhere(false));
    assert.match(where, /missingAudioFeature|audioFeature|NOT/);
    assert.match(where, /audioFeatureAnalyzedAt/);
    assert.match(where, /local_essentia/);
    assert.match(where, /local_heuristic/);
    assert.doesNotMatch(where, /audioFeatureSource.*api/);
  });

  it("allows explicit local reprocess mode to target existing local attempts", () => {
    const where = JSON.stringify(localAudioFeatureWhere(true));
    assert.match(where, /local_essentia/);
    assert.match(where, /local_heuristic/);
    assert.match(where, /"audioFeature":null/);
  });

  it("blocks duplicate local backfill jobs before expensive analysis starts", async () => {
    resetJobLocksForTests();
    const lock = acquireJobLock({
      name: "test local audio feature job",
      keys: ["audio_feature:local"],
      source: "test",
    });
    assert.equal(lock.acquired, true);

    try {
      const summary = await runLocalAudioFeatureEngine();
      assert.deepEqual(summary, { attempted: 0, processed: 0, skipped: 0, failed: 0 });
    } finally {
      if (lock.acquired) lock.release();
      resetJobLocksForTests();
    }
  });
});
