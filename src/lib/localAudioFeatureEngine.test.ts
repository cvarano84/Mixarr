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
        tempo: 122.5,
        localEnergy: 0.72,
        localMood: 0.43,
        localDanceability: 0.66,
        localAcousticness: 0.22,
        source: "Essentia local audio analysis",
        audioFeatureSource: "local_essentia",
        audioFeatureStatus: "success",
        audioFeatureConfidence: 0.81,
        audioFeatureAnalyzedAt: new Date(),
        audioFeatureAnalysisScope: "whole_track",
        energySource: "local_essentia",
        valenceSource: "local_essentia",
        danceabilitySource: "local_essentia",
        acousticnessSource: "local_essentia",
      },
    };

    assert.equal(needsLocalAudioFeatureBackfill(track, {
      preferLocal: true,
      analysisScope: "whole_track",
    }), false);
  });

  it("skips already-complete local Essentia rows after restart or stale retry state", () => {
    const track = {
      syncStatus: "active",
      audioFeature: {
        energy: 0.85,
        valence: 0.59,
        danceability: 0.96,
        acousticness: 0.32,
        tempo: 122.5,
        localEnergy: 0.85,
        localMood: 0.59,
        localDanceability: 0.96,
        localAcousticness: 0.32,
        source: "Essentia local audio analysis",
        audioFeatureSource: "local_essentia",
        audioFeatureStatus: "success",
        audioFeatureConfidence: 0.95,
        audioFeatureAnalyzedAt: null,
        audioFeatureAnalysisScope: "whole_track",
        energySource: "local_essentia",
        valenceSource: "local_essentia",
        danceabilitySource: "local_essentia",
        acousticnessSource: "local_essentia",
      },
    };

    assert.equal(needsLocalAudioFeatureBackfill(track, {
      reprocessApiWithLocal: true,
      preferLocal: true,
      analysisScope: "whole_track",
    }), false);
  });

  it("does not reprocess local no-data, failed, or too-short attempts until retry/reset", () => {
    for (const status of ["no_data", "extraction_failed", "analyzer_failed", "too_short"]) {
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

  it("retries partial rows with null local fields so the next local save can merge them", () => {
    assert.equal(needsLocalAudioFeatureBackfill({
      syncStatus: "active",
      audioFeature: {
        apiEnergy: 0.7,
        apiMood: null,
        apiDanceability: null,
        apiAcousticness: null,
        localEnergy: null,
        localMood: null,
        localDanceability: null,
        localAcousticness: null,
        tempo: 120,
        source: "Spotify Audio Features",
        audioFeatureSource: "api",
        audioFeatureStatus: "partial",
        audioFeatureAnalyzedAt: null,
      },
    }, {
      preferLocal: true,
      reprocessApiWithLocal: true,
      analysisScope: "whole_track",
    }), true);
  });

  it("retries incomplete partial rows even when a previous local attempt timestamp exists", () => {
    assert.equal(needsLocalAudioFeatureBackfill({
      syncStatus: "active",
      audioFeature: {
        localEnergy: 0.71,
        localMood: null,
        localDanceability: 0.62,
        localAcousticness: 0.21,
        energy: 0.71,
        valence: null,
        danceability: 0.62,
        acousticness: 0.21,
        tempo: 120,
        source: "Essentia local audio analysis",
        audioFeatureSource: "local_essentia",
        audioFeatureStatus: "partial",
        audioFeatureAnalyzedAt: new Date(),
        audioFeatureAnalysisScope: "whole_track",
        energySource: "local_essentia",
        valenceSource: "local_essentia",
        danceabilitySource: "local_essentia",
        acousticnessSource: "local_essentia",
      },
    }, {
      preferLocal: true,
      analysisScope: "whole_track",
    }), true);
  });

  it("does not need backfill after local retry fills an existing partial row", () => {
    assert.equal(needsLocalAudioFeatureBackfill({
      syncStatus: "active",
      audioFeature: {
        apiEnergy: 0.7,
        apiMood: null,
        apiDanceability: null,
        apiAcousticness: null,
        localEnergy: 0.71,
        localMood: 0.48,
        localDanceability: 0.62,
        localAcousticness: 0.21,
        energy: 0.71,
        valence: 0.48,
        danceability: 0.62,
        acousticness: 0.21,
        tempo: 120,
        source: "Spotify Audio Features",
        audioFeatureSource: "mixed",
        audioFeatureStatus: "success",
        audioFeatureAnalyzedAt: new Date(),
        audioFeatureAnalysisScope: "whole_track",
        energySource: "local_essentia",
        valenceSource: "local_essentia",
        danceabilitySource: "local_essentia",
        acousticnessSource: "local_essentia",
      },
    }, {
      preferLocal: true,
      reprocessApiWithLocal: true,
      analysisScope: "whole_track",
    }), false);
  });

  it("uses terminal local-attempt exclusion in the missing query so restarts resume remaining tracks", () => {
    const where = JSON.stringify(localAudioFeatureWhere(false, false, "whole_track"));
    assert.match(where, /missingAudioFeature|audioFeature|NOT/);
    assert.match(where, /audioFeatureAnalyzedAt/);
    assert.match(where, /no_data/);
    assert.match(where, /too_short/);
    assert.match(where, /local_essentia/);
    assert.match(where, /local_heuristic/);
    assert.doesNotMatch(where, /apiAudioFeatureReprocessWhere/);
  });

  it("allows explicit local reprocess mode to target existing local attempts", () => {
    const where = JSON.stringify(localAudioFeatureWhere(true));
    assert.match(where, /local_essentia/);
    assert.match(where, /local_heuristic/);
    // Reprocess still covers missing/no-row tracks via the null-safe missing predicate,
    // whose no-row branch is a literal {audioFeature:null}.
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

  it("persists local analysis with upsert merge semantics and concrete local field sources", async () => {
    const source = await readFile(path.join(process.cwd(), "src/lib/localAudioFeatureEngine.ts"), "utf8");
    assert.match(source, /prisma\.audioFeature\.upsert/);
    assert.match(source, /update\.localMood = result\.valence/);
    assert.match(source, /setField\("valence", "valenceSource", result\.valence, "local_essentia"\)/);
    assert.match(source, /audioFeatureStatusFor/);
  });
});
