import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { normalizeMetadataAnalysisScope, resolveMetadataProviderSettings } from "./syncSettings";

const envKeys = [
  "ENABLE_API_BPM",
  "ENABLE_LOCAL_BPM",
  "PREFER_LOCAL_BPM",
  "REPROCESS_API_BPM_WITH_LOCAL",
  "LOCAL_BPM_ANALYSIS_SCOPE",
  "ENABLE_API_AUDIO_FEATURES",
  "ENABLE_LOCAL_AUDIO_FEATURES",
  "PREFER_LOCAL_AUDIO_FEATURES",
  "REPROCESS_API_AUDIO_FEATURES_WITH_LOCAL",
  "LOCAL_AUDIO_FEATURES_SCOPE",
  "ALLOW_ESTIMATED_AUDIO_FEATURES",
] as const;

const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of envKeys) {
    const original = originalEnv[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe("metadata provider settings", () => {
  it("defaults safely when env and user settings are missing", () => {
    for (const key of envKeys) delete process.env[key];
    const settings = resolveMetadataProviderSettings();

    assert.deepEqual(settings.bpm, {
      api: true,
      local: true,
      preferLocal: false,
      reprocessApiWithLocal: false,
      scope: "windows",
    });
    assert.equal(settings.audioFeatures.api, true);
    assert.equal(settings.audioFeatures.local, true);
    assert.equal(settings.audioFeatures.preferLocal, false);
    assert.equal(settings.audioFeatures.reprocessApiWithLocal, false);
    assert.equal(settings.audioFeatures.scope, "windows");
    assert.equal(settings.audioFeatures.allowEstimated, true);
  });

  it("normalizes invalid scope values to windows", () => {
    assert.equal(normalizeMetadataAnalysisScope("bad"), "windows");
    assert.equal(normalizeMetadataAnalysisScope("whole_track"), "whole_track");
  });

  it("supports local-only audio and BPM modes", () => {
    const settings = resolveMetadataProviderSettings({
      enableApiBpm: false,
      enableLocalBpm: true,
      enableApiAudioFeatures: false,
      enableLocalAudioFeatures: true,
      preferLocalBpm: true,
      preferLocalAudioFeatures: true,
      localBpmAnalysisScope: "whole_track",
      localAudioFeaturesScope: "whole_track",
    });

    assert.equal(settings.bpm.api, false);
    assert.equal(settings.bpm.local, true);
    assert.equal(settings.bpm.preferLocal, true);
    assert.equal(settings.bpm.scope, "whole_track");
    assert.equal(settings.audioFeatures.api, false);
    assert.equal(settings.audioFeatures.local, true);
    assert.equal(settings.audioFeatures.preferLocal, true);
    assert.equal(settings.audioFeatures.scope, "whole_track");
  });
});
