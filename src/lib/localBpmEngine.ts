import { spawn } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import prisma from "./prisma";
import { getDeezerBpm } from "./providers/deezer";
import { resolveDelayMs, resolveLimit, type SyncEngineOptions } from "./syncSettings";
import {
  engineBatchSize,
  trackAttemptsTotal,
  trackDurationSeconds,
} from "./metrics";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const ENGINE = "bpm";

function positiveNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

const sampleWindowSeconds = positiveNumber(process.env.LOCAL_BPM_SAMPLE_SECONDS, 60);
const retryDays = Number(process.env.LOCAL_BPM_RETRY_DAYS || 14);
const confidenceThreshold = Number(process.env.LOCAL_BPM_CONFIDENCE_THRESHOLD || 0.75);
const ffmpegPath = process.env.LOCAL_BPM_FFMPEG_PATH || "ffmpeg";
const aubioPath = process.env.LOCAL_BPM_AUBIO_PATH || "aubio";

type CommandResult = {
  stdout: string;
  stderr: string;
};

type BpmSampleWindow = {
  label: string;
  startSeconds: number;
  durationSeconds: number;
};

type LocalBpmResult = {
  tempo: number;
  confidence: number;
  beats: number;
};

type WindowBpmResult = LocalBpmResult & {
  windowLabel: string;
};

function plexClientIdentifier() {
  return (process.env.PLEX_CLIENT_IDENTIFIER || "mixarr").trim();
}

function validBpm(value: unknown) {
  const bpm = Number(value);
  return Number.isFinite(bpm) && bpm >= 40 && bpm <= 260 ? bpm : null;
}

function normalizeBpm(value: number) {
  let bpm = value;
  while (bpm < 70) bpm *= 2;
  while (bpm > 210) bpm /= 2;
  return Number(bpm.toFixed(2));
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function buildPlexTranscodeUrl(serverUri: string, ratingKey: string, accessToken: string, offsetSeconds = 0) {
  const url = new URL("/music/:/transcode/universal/start.mp3", serverUri);
  url.searchParams.set("path", `/library/metadata/${ratingKey}`);
  url.searchParams.set("protocol", "http");
  url.searchParams.set("directPlay", "0");
  url.searchParams.set("directStream", "0");
  url.searchParams.set("directStreamAudio", "0");
  url.searchParams.set("mediaIndex", "0");
  url.searchParams.set("partIndex", "0");
  url.searchParams.set("musicBitrate", "192");
  url.searchParams.set("audioChannelCount", "2");
  url.searchParams.set("location", "lan");
  url.searchParams.set("offset", String(Math.max(0, Math.floor(offsetSeconds))));
  url.searchParams.set("transcodeSessionId", `mixarr-local-bpm-${crypto.randomUUID()}`);
  url.searchParams.set("X-Plex-Token", accessToken);
  url.searchParams.set("X-Plex-Client-Identifier", plexClientIdentifier());
  url.searchParams.set("X-Plex-Product", "Mixarr");
  url.searchParams.set("X-Plex-Platform", "Web");
  return url.toString();
}

function runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} exited with ${code}: ${stderr.slice(0, 500)}`));
      }
    });
  });
}

function clampSampleStart(startSeconds: number, trackDurationSeconds: number | null, durationSeconds: number) {
  if (!trackDurationSeconds) return Math.max(0, startSeconds);
  return Math.max(0, Math.min(startSeconds, Math.max(0, trackDurationSeconds - durationSeconds)));
}

function buildBpmSampleWindows(trackDurationMs?: number | null) {
  const trackDurationSeconds = trackDurationMs ? trackDurationMs / 1000 : null;
  const windowDurationSeconds = trackDurationSeconds
    ? Math.min(sampleWindowSeconds, trackDurationSeconds)
    : sampleWindowSeconds;
  const windows: BpmSampleWindow[] = [];

  const addWindow = (label: string, preferredStartSeconds: number) => {
    const startSeconds = clampSampleStart(preferredStartSeconds, trackDurationSeconds, windowDurationSeconds);
    const duplicate = windows.some((window) =>
      Math.abs(window.startSeconds - startSeconds) < 5 &&
      Math.abs(window.durationSeconds - windowDurationSeconds) < 5,
    );

    if (!duplicate) {
      windows.push({
        label,
        startSeconds: Number(startSeconds.toFixed(2)),
        durationSeconds: Number(windowDurationSeconds.toFixed(2)),
      });
    }
  };

  addWindow("30s-90s", 30);

  if (trackDurationSeconds) {
    addWindow("middle 60s", (trackDurationSeconds / 2) - (windowDurationSeconds / 2));
    addWindow("last third 60s", trackDurationSeconds * (2 / 3));
  }

  return windows;
}

async function extractAudioSample(inputUrl: string, outputPath: string, durationSeconds: number) {
  await runCommand(ffmpegPath, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-t",
    String(durationSeconds),
    "-i",
    inputUrl,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "44100",
    "-sample_fmt",
    "s16",
    outputPath,
  ], Math.max(60000, durationSeconds * 2000));
}

async function analyzeBpmWithAubio(wavPath: string, durationSeconds: number): Promise<LocalBpmResult | null> {
  const result = await runCommand(aubioPath, ["tempo", wavPath], 120000);
  const directBpm = result.stdout.match(/([0-9]+(?:\.[0-9]+)?)\s*bpm/i);
  if (directBpm) {
    const bpm = validBpm(directBpm[1]);
    if (bpm) return { tempo: normalizeBpm(bpm), confidence: 0.7, beats: 0 };
  }

  const beatTimes = result.stdout
    .split(/\r?\n/)
    .map((line) => Number(line.match(/-?[0-9]+(?:\.[0-9]+)?/)?.[0]))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= durationSeconds);

  if (beatTimes.length < 6) return null;

  const intervals = beatTimes
    .slice(1)
    .map((beat, index) => beat - beatTimes[index])
    .filter((interval) => interval > 0.23 && interval < 1.5);

  if (intervals.length < 5) return null;

  const bpm = validBpm(60 / median(intervals));
  if (!bpm) return null;

  const intervalMedian = median(intervals);
  const intervalStdDev = standardDeviation(intervals);
  const stability = intervalMedian > 0 ? Math.max(0, 1 - (intervalStdDev / intervalMedian)) : 0;
  const beatCoverage = Math.min(1, intervals.length / Math.max(12, durationSeconds / 4));
  const confidence = Math.max(0.5, Math.min(0.9, 0.45 + stability * 0.35 + beatCoverage * 0.15));

  return {
    tempo: normalizeBpm(bpm),
    confidence,
    beats: beatTimes.length,
  };
}

function combineWindowResults(results: WindowBpmResult[], expectedWindowCount: number) {
  if (results.length === 0) return null;
  if (results.length === 1) return results[0];

  const sortedResults = [...results].sort((a, b) => b.confidence - a.confidence);
  const clusters: WindowBpmResult[][] = [];

  for (const result of sortedResults) {
    const cluster = clusters.find((candidate) =>
      Math.abs(median(candidate.map((item) => item.tempo)) - result.tempo) <= 2.5,
    );

    if (cluster) {
      cluster.push(result);
    } else {
      clusters.push([result]);
    }
  }

  const bestCluster = clusters
    .sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      const aConfidence = a.reduce((sum, item) => sum + item.confidence, 0) / a.length;
      const bConfidence = b.reduce((sum, item) => sum + item.confidence, 0) / b.length;
      return bConfidence - aConfidence;
    })[0];

  const tempos = bestCluster.map((result) => result.tempo);
  const confidenceMean = bestCluster.reduce((sum, result) => sum + result.confidence, 0) / bestCluster.length;
  const agreementBoost = Math.min(0.16, (bestCluster.length - 1) * 0.08);
  const coveragePenalty = Math.max(0, expectedWindowCount - results.length) * 0.04;
  const disagreementPenalty = Math.max(0, results.length - bestCluster.length) * 0.06;
  const spreadPenalty = Math.min(0.12, standardDeviation(tempos) / 25);

  return {
    tempo: normalizeBpm(median(tempos)),
    confidence: Math.max(
      0.5,
      Math.min(0.95, confidenceMean + agreementBoost - coveragePenalty - disagreementPenalty - spreadPenalty),
    ),
    beats: bestCluster.reduce((sum, result) => sum + result.beats, 0),
    windowLabel: bestCluster.map((result) => result.windowLabel).join(", "),
  };
}

async function assertLocalBpmDependencies() {
  await runCommand(ffmpegPath, ["-version"], 10000);
  await runCommand(aubioPath, ["--version"], 10000);
}

async function analyzeTrackLocally(track: any) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mixarr-bpm-"));

  try {
    const server = track.library.server;
    const ratingKey = track.ratingKey || track.plexId;
    const sampleWindows = buildBpmSampleWindows(track.duration);
    const results: WindowBpmResult[] = [];

    for (let index = 0; index < sampleWindows.length; index++) {
      const sampleWindow = sampleWindows[index];
      const wavPath = path.join(tempDir, `sample-${index}.wav`);
      const audioUrl = buildPlexTranscodeUrl(
        server.uri,
        ratingKey,
        server.accessToken,
        sampleWindow.startSeconds,
      );

      await extractAudioSample(audioUrl, wavPath, sampleWindow.durationSeconds);
      const bpm = await analyzeBpmWithAubio(wavPath, sampleWindow.durationSeconds);
      if (bpm) {
        results.push({
          ...bpm,
          windowLabel: sampleWindow.label,
        });
      }
    }

    return combineWindowResults(results, sampleWindows.length);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function saveTempo(trackId: string, tempo: number | null, source: string, confidence: number) {
  await prisma.audioFeature.upsert({
    where: { trackId },
    update: {
      tempo,
      tempoSource: source,
      tempoConfidence: confidence,
      lastUpdated: new Date(),
    },
    create: {
      trackId,
      tempo,
      tempoSource: source,
      tempoConfidence: confidence,
      source,
      confidence,
      lastUpdated: new Date(),
    },
  });
}

async function findTracksForBpmBackfill(batchSize?: number) {
  const retryBefore = new Date(Date.now() - retryDays * 24 * 60 * 60 * 1000);

  return prisma.track.findMany({
    where: {
      OR: [
        { audioFeature: null },
        {
          audioFeature: {
            is: {
              tempo: null,
              OR: [
                { tempoSource: { not: "local_not_found" } },
                { lastUpdated: { lt: retryBefore } },
              ],
            },
          },
        },
        {
          audioFeature: {
            is: {
              tempoConfidence: { lt: confidenceThreshold },
              OR: [
                { tempoSource: { not: "local_not_found" } },
                { lastUpdated: { lt: retryBefore } },
              ],
            },
          },
        },
        {
          audioFeature: {
            is: {
              tempoSource: { in: ["not_found", "AudioDB (Unknown Mood)", "estimated"] },
            },
          },
        },
      ],
    },
    include: {
      artist: true,
      library: {
        include: {
          server: true,
        },
      },
      audioFeature: true,
    },
    orderBy: { addedAt: "desc" },
    ...(batchSize ? { take: batchSize } : {}),
  });
}

export const runLocalBpmEngine = async (options: SyncEngineOptions = {}) => {
  console.log("[LocalBpmEngine] Starting BPM backfill...");

  try {
    const batchSize = resolveLimit(options.bpmBatchSize, "LOCAL_BPM_BATCH_SIZE");
    const providerDelayMs = resolveDelayMs(options.providerDelayMs, 250);
    await assertLocalBpmDependencies();
    const tracksToProcess = await findTracksForBpmBackfill(batchSize);
    console.log(`[LocalBpmEngine] Found ${tracksToProcess.length} tracks needing BPM backfill.`);
    engineBatchSize.observe({ engine: ENGINE }, tracksToProcess.length);

    for (const track of tracksToProcess) {
      let outcome: "success" | "not_found" | "rate_limited" | "error" = "success";
      const endTimer = trackDurationSeconds.startTimer({ engine: ENGINE });
      try {
        const deezerBpm = validBpm(await getDeezerBpm(track.artist.title, track.title));
        if (deezerBpm) {
          const tempo = normalizeBpm(deezerBpm);
          await saveTempo(track.id, tempo, "Deezer", 0.9);
          console.log(`[LocalBpmEngine] ${track.artist.title} - ${track.title} -> ${tempo} BPM (Deezer)`);
          continue;
        }

        const localBpm = await analyzeTrackLocally(track);
        if (localBpm) {
          await saveTempo(track.id, localBpm.tempo, "Aubio local multi-window analysis", localBpm.confidence);
          console.log(`[LocalBpmEngine] ${track.artist.title} - ${track.title} -> ${localBpm.tempo} BPM (Aubio ${localBpm.windowLabel}, confidence ${localBpm.confidence.toFixed(2)})`);
        } else {
          await saveTempo(track.id, null, "local_not_found", 0);
          console.log(`[LocalBpmEngine] ${track.artist.title} - ${track.title} -> BPM not found`);
          outcome = "not_found";
        }
      } catch (error: any) {
        console.error(`[LocalBpmEngine] Failed ${track.artist.title} - ${track.title}:`, error.message);
        await saveTempo(track.id, null, "local_not_found", 0).catch(() => undefined);
        outcome = "error";
      } finally {
        endTimer();
        trackAttemptsTotal.inc({ engine: ENGINE, result: outcome });
      }

      if (providerDelayMs > 0) {
        await sleep(providerDelayMs);
      }
    }

    console.log("[LocalBpmEngine] BPM backfill completed.");
  } catch (error) {
    console.error("[LocalBpmEngine] Sync failed", error);
  }
};
