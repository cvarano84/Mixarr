import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  apiAudioFeatureTrackWhere,
  audioFeatureFilterGuardWhere,
  audioFeatureRetryEligibilityTrackWhere,
  completeAudioFeatureTrackWhere,
  getEffectiveAudioFeatures,
  heuristicAudioFeatureTrackWhere,
  localEssentiaAudioFeatureSuccessTrackWhere,
  missingAudioFeatureTrackWhere,
  partialAudioFeatureTrackWhere,
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
    assert.match(missing, /audioFeature/);
  });

  it("detects missing audio features null-safely with positive predicates, not a relation NOT", () => {
    const missing = missingAudioFeatureTrackWhere() as { OR?: unknown[] };
    // no-row branch + incomplete-existing-row branch, both positive.
    assert.ok(Array.isArray(missing.OR), "expected an OR of no-row and incomplete-row branches");
    const serialized = JSON.stringify(missing);
    // Regression guard: negating a to-one relation (NOT {audioFeature:{is:...}}, or the
    // inner is:{NOT:...}) compiles to a NULL-propagating LEFT JOIN in Prisma and strands
    // not_found / 0.5-placeholder rows out of backfill. The predicate must stay positive.
    assert.doesNotMatch(serialized, /"NOT":\{"audioFeature"/);
    assert.doesNotMatch(serialized, /"is":\{"NOT"/);
    assert.match(serialized, /audioFeature/);
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

  it("treats complete local Essentia success as effective local audio features", () => {
    const effective = getEffectiveAudioFeatures({
      audioFeature: {
        energy: 0.15,
        valence: 0.25,
        danceability: 0.35,
        acousticness: 0.45,
        tempo: 122.5,
        localEnergy: 0.8,
        localMood: 0.7,
        localDanceability: 0.6,
        localAcousticness: 0.5,
        audioFeatureSource: "local_essentia",
        audioFeatureStatus: "success",
        audioFeatureConfidence: 0.95,
        audioFeatureAnalysisScope: "whole_track",
      },
    }, { preferLocalAudioFeatures: true });

    assert.equal(effective.complete, true);
    assert.equal(effective.source, "local_essentia");
    assert.equal(effective.energy, 0.8);
    assert.equal(effective.mood, 0.7);
    assert.deepEqual(effective.missingFields, []);
  });

  it("lets local Essentia fields satisfy health when API features are disabled", () => {
    const effective = getEffectiveAudioFeatures({
      audioFeature: {
        localEnergy: 0.8,
        localMood: 0.7,
        localDanceability: 0.6,
        localAcousticness: 0.5,
        tempo: 121,
        audioFeatureSource: "local_essentia",
        audioFeatureStatus: "success",
        energySource: "local_essentia",
        valenceSource: "local_essentia",
        danceabilitySource: "local_essentia",
        acousticnessSource: "local_essentia",
      },
    }, { preferLocalAudioFeatures: true, allowEstimated: false });

    assert.equal(effective.complete, true);
    assert.equal(effective.partial, false);
    assert.deepEqual(effective.missingFields, []);
  });

  it("does not treat stale partial status as partial when all persisted local fields are valid", () => {
    const effective = getEffectiveAudioFeatures({
      audioFeature: {
        localEnergy: 0.42,
        localMood: 0.53,
        localDanceability: 0.64,
        localAcousticness: 0.25,
        tempo: 118,
        audioFeatureSource: "local_essentia",
        audioFeatureStatus: "partial",
      },
    }, { preferLocalAudioFeatures: true });

    assert.equal(effective.complete, true);
    assert.equal(effective.partial, false);
  });

  it("keeps truly incomplete persisted feature data partial and names missing fields", () => {
    const effective = getEffectiveAudioFeatures({
      audioFeature: {
        localEnergy: 0.42,
        localMood: null,
        localDanceability: 0.64,
        localAcousticness: 0.25,
        tempo: 118,
        audioFeatureSource: "local_essentia",
        audioFeatureStatus: "partial",
      },
    }, { preferLocalAudioFeatures: true });

    assert.equal(effective.complete, false);
    assert.equal(effective.partial, true);
    assert.deepEqual(effective.missingFields, ["mood"]);
  });

  it("honors provider priority when API and local features both exist", () => {
    const track = {
      audioFeature: {
        apiEnergy: 0.2,
        apiMood: 0.3,
        apiDanceability: 0.4,
        apiAcousticness: 0.5,
        localEnergy: 0.7,
        localMood: 0.6,
        localDanceability: 0.5,
        localAcousticness: 0.4,
        tempo: 120,
        audioFeatureSource: "mixed",
        audioFeatureStatus: "success",
        source: "Spotify Audio Features",
      },
    };

    assert.equal(getEffectiveAudioFeatures(track, { preferLocalAudioFeatures: true }).energy, 0.7);
    assert.equal(getEffectiveAudioFeatures(track, { preferLocalAudioFeatures: false }).energy, 0.2);
  });

  it("does not count fake neutral placeholders as complete effective features", () => {
    const effective = getEffectiveAudioFeatures({
      audioFeature: {
        energy: 0.5,
        valence: 0.5,
        danceability: 0.5,
        acousticness: 0.5,
        tempo: 120,
        source: "Unknown Mood estimated",
        audioFeatureSource: "local_heuristic",
        audioFeatureStatus: "no_data",
        audioFeatureConfidence: 0,
      },
    }, { preferLocalAudioFeatures: true, allowEstimated: true });

    assert.equal(effective.complete, false);
    assert.match(JSON.stringify(completeAudioFeatureTrackWhere()), /audioFeatureStatus/);
  });

  it("keeps complete local Essentia rows out of partial and retry predicates", () => {
    const partial = JSON.stringify(partialAudioFeatureTrackWhere());
    const retry = JSON.stringify(audioFeatureRetryEligibilityTrackWhere({ providerMode: "configured", analysisScope: "whole_track" }));
    const localSuccess = JSON.stringify(localEssentiaAudioFeatureSuccessTrackWhere("whole_track"));

    assert.match(partial, /partial/);
    // Incompleteness is matched positively (via incompleteAudioFeatureWhere) rather than a
    // relation-level NOT, which would NULL-poison rows with null feature columns.
    assert.doesNotMatch(partial, /"NOT":\{"audioFeature"/);
    assert.match(partial, /localEnergy/);
    assert.match(partial, /localMood/);
    assert.match(retry, /local_essentia/);
    assert.match(retry, /too_short/);
    assert.match(localSuccess, /whole_track/);
    assert.match(localSuccess, /success/);
  });
});
