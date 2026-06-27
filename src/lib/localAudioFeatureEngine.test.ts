import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "fs/promises";
import path from "path";
import { normalizeAudioFeatureAnalysisScope } from "./localAudioFeatureEngine";

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
