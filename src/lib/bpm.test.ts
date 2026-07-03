import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bpmBackfillCandidateTrackWhere,
  bpmBackfillTrackWhere,
  bpmRetryEligibilityTrackWhere,
  explainBpmBackfillEligibility,
  hasEffectiveBpm,
  hasLocalEssentiaBpmSuccess,
  localEssentiaBpmSuccessTrackWhere,
} from "./bpm";

describe("BPM eligibility", () => {
  it("treats local_essentia success as completed effective BPM", () => {
    const track = {
      bpm: 134.85,
      localBpm: 134.85,
      bpmSource: "local_essentia",
      bpmAnalysisStatus: "success",
      audioFeature: {
        tempo: 134.85,
        tempoSource: "Essentia local whole-track analysis",
      },
    };

    assert.equal(hasEffectiveBpm(track), true);
    assert.equal(hasLocalEssentiaBpmSuccess(track), true);
    assert.deepEqual(explainBpmBackfillEligibility(track, {
      reprocessApiWithLocal: true,
      includeAubioReprocess: true,
      retryNoDataFailed: true,
    }).selected, false);
  });

  it("excludes local_essentia success rows from backfill and API reprocess", () => {
    const where = JSON.stringify(bpmBackfillCandidateTrackWhere({ reprocessApiWithLocal: true }));

    assert.match(where, /local_essentia/);
    assert.match(where, /NOT/);
    assert.match(where, /apiBpm/);
  });

  it("selects API BPM for local reprocess only when no local_essentia success exists", () => {
    const apiOnly = explainBpmBackfillEligibility({
      bpm: 120,
      apiBpm: 120,
      bpmSource: "api",
      bpmAnalysisStatus: "success",
      audioFeature: null,
    }, { reprocessApiWithLocal: true });
    const alreadyLocal = explainBpmBackfillEligibility({
      bpm: 120,
      apiBpm: 118,
      localBpm: 120,
      bpmSource: "local_essentia",
      bpmAnalysisStatus: "success",
      audioFeature: { tempo: 120, tempoSource: "Essentia local whole-track analysis" },
    }, { reprocessApiWithLocal: true });

    assert.equal(apiOnly.selected, true);
    assert.equal(apiOnly.reason, "api_or_imported_reprocess_without_local_success");
    assert.equal(alreadyLocal.selected, false);
  });

  it("retry eligibility skips already-completed tracks after restart unless forced", () => {
    const retry = JSON.stringify(bpmRetryEligibilityTrackWhere({ providerMode: "configured" }));
    const force = JSON.stringify(bpmRetryEligibilityTrackWhere({ providerMode: "force_local" }));

    assert.match(retry, /local_essentia/);
    assert.match(retry, /too_short/);
    assert.match(retry, /NOT/);
    assert.equal(force, "{}");
  });

  it("queue status candidates and found count can use the same candidate query", () => {
    const options = {
      includeAubioReprocess: true,
      retryNoDataFailed: false,
      reprocessApiWithLocal: true,
    };

    const foundWhere = bpmBackfillTrackWhere(options);
    const queueStatusWhere = {
      AND: [
        { syncStatus: "active" },
        bpmBackfillCandidateTrackWhere(options),
      ],
    };

    assert.deepEqual(foundWhere, queueStatusWhere);
  });

  it("recognizes local success from canonical local BPM fields", () => {
    assert.equal(hasLocalEssentiaBpmSuccess({ localBpm: 121 }), true);
    assert.equal(hasLocalEssentiaBpmSuccess({
      bpmSource: "local_essentia",
      bpmAnalysisStatus: "success",
    }), true);
    assert.equal(hasLocalEssentiaBpmSuccess({
      audioFeature: { tempo: 121, tempoSource: "Essentia local whole-track analysis" },
    }), true);

    const localSuccessWhere = JSON.stringify(localEssentiaBpmSuccessTrackWhere());
    assert.match(localSuccessWhere, /localBpm/);
    assert.match(localSuccessWhere, /bpmAnalysisStatus/);
    assert.match(localSuccessWhere, /tempoSource/);
  });
});
