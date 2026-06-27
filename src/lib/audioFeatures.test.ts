import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  apiAudioFeatureTrackWhere,
  audioFeatureFilterGuardWhere,
  completeAudioFeatureTrackWhere,
  heuristicAudioFeatureTrackWhere,
  missingAudioFeatureTrackWhere,
} from "./audioFeatures";

describe("audio feature health predicates", () => {
  it("does not count neutral placeholder rows as complete audio features", () => {
    const complete = JSON.stringify(completeAudioFeatureTrackWhere());
    assert.match(complete, /energy/);
    assert.match(complete, /valence/);
    assert.match(complete, /danceability/);
    assert.match(complete, /tempo/);
    assert.match(complete, /Deezer BPM only/);
    assert.match(complete, /Unknown Mood/);
    assert.match(complete, /not_found/);

    const missing = JSON.stringify(missingAudioFeatureTrackWhere());
    assert.match(missing, /NOT/);
    assert.match(missing, /audioFeature/);
  });

  it("separates API, local, and heuristic feature sources", () => {
    assert.match(JSON.stringify(apiAudioFeatureTrackWhere()), /api/);
    assert.match(JSON.stringify(heuristicAudioFeatureTrackWhere()), /local_heuristic/);
  });

  it("excludes heuristic field values from filters unless explicitly allowed", () => {
    const strict = JSON.stringify(audioFeatureFilterGuardWhere("valenceSource", {
      includeEstimated: false,
      minimumConfidence: 0.7,
    }));
    assert.match(strict, /local_heuristic/);
    assert.match(strict, /audioFeatureConfidence/);

    const permissive = JSON.stringify(audioFeatureFilterGuardWhere("valenceSource", {
      includeEstimated: true,
      minimumConfidence: null,
    }));
    assert.doesNotMatch(permissive, /valenceSource/);
  });
});
