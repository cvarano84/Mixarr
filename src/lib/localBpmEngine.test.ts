import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { buildFfmpegFullTrackDecodeArgs, buildFfmpegSampleArgs, redactSensitiveUrl, validateAudioSample } from "./localBpmEngine";

describe("LocalBpmEngine sample safety", () => {
  it("builds both fast pre-input and accurate post-input seek commands", () => {
    const source = { type: "plex-direct-download" as const, input: "https://plex.test/audio" };
    const fast = buildFfmpegSampleArgs(source, 30, 60, true);
    const accurate = buildFfmpegSampleArgs(source, 30, 60, false);
    assert.ok(fast.indexOf("-ss") < fast.indexOf("-i"));
    assert.ok(accurate.indexOf("-ss") > accurate.indexOf("-i"));
  });

  it("builds full-track decode commands without a sample duration", () => {
    const source = { type: "local-file" as const, input: "/music/song.flac" };
    const args = buildFfmpegFullTrackDecodeArgs(source, "/tmp/song.wav");
    assert.equal(args.includes("-t"), false);
    assert.deepEqual(args.slice(-4), ["pcm_s16le", "-f", "wav", "/tmp/song.wav"]);
  });

  it("rejects missing and undersized samples before ffprobe", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "mixarr-bpm-test-"));
    try {
      const missing = await validateAudioSample(path.join(tempDir, "missing.wav"));
      assert.equal(missing.ok, false);
      assert.match(missing.reason || "", /does not exist/);

      const tiny = path.join(tempDir, "tiny.wav.tmp");
      await writeFile(tiny, Buffer.alloc(1024));
      const invalid = await validateAudioSample(tiny);
      assert.equal(invalid.ok, false);
      assert.match(invalid.reason || "", /too small/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("redacts Plex tokens and URLs from error messages", () => {
    const redacted = redactSensitiveUrl("failed https://plex.test/file?X-Plex-Token=secret-token&download=1");
    assert.doesNotMatch(redacted, /secret-token/);
    assert.match(redacted, /redacted/);
  });

  it("uses a BPM-focused Essentia algorithm and atomic temporary files", async () => {
    const source = await readFile(path.join(process.cwd(), "src/lib/localBpmEngine.ts"), "utf8");
    assert.match(source, /RhythmExtractor2013/);
    assert.doesNotMatch(source, /MusicExtractorSVM/);
    assert.match(source, /validateAudioSample\(temporaryPath/);
    assert.match(source, /rename\(temporaryPath, outputPath\)/);
  });
});
