import { spawn } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import prisma from "./prisma";
import { getDeezerBpm } from "./providers/deezer";
import { resolveDelayMs, resolveLimit, type SyncEngineOptions } from "./syncSettings";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const sampleSeconds = Number(process.env.LOCAL_BPM_SAMPLE_SECONDS || 180);
const retryDays = Number(process.env.LOCAL_BPM_RETRY_DAYS || 14);
const confidenceThreshold = Number(process.env.LOCAL_BPM_CONFIDENCE_THRESHOLD || 0.75);
const ffmpegPath = process.env.LOCAL_BPM_FFMPEG_PATH || "ffmpeg";
const aubioPath = process.env.LOCAL_BPM_AUBIO_PATH || "aubio";

type CommandResult = {
  stdout: string;
  stderr: string;
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

function buildPlexTranscodeUrl(serverUri: string, ratingKey: string, accessToken: string) {
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
  url.searchParams.set("offset", "0");
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

async function extractAudioSample(inputUrl: string, outputPath: string) {
  await runCommand(ffmpegPath, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-t",
    String(sampleSeconds),
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
  ], Math.max(60000, sampleSeconds * 2000));
}

async function analyzeBpmWithAubio(wavPath: string) {
  const result = await runCommand(aubioPath, ["tempo", wavPath], 120000);
  const directBpm = result.stdout.match(/([0-9]+(?:\.[0-9]+)?)\s*bpm/i);
  if (directBpm) {
    const bpm = validBpm(directBpm[1]);
    if (bpm) return { tempo: normalizeBpm(bpm), confidence: 0.7, beats: 0 };
  }

  const beatTimes = result.stdout
    .split(/\r?\n/)
    .map((line) => Number(line.match(/-?[0-9]+(?:\.[0-9]+)?/)?.[0]))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= sampleSeconds);

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
  const beatCoverage = Math.min(1, intervals.length / Math.max(12, sampleSeconds / 4));
  const confidence = Math.max(0.5, Math.min(0.9, 0.45 + stability * 0.35 + beatCoverage * 0.15));

  return {
    tempo: normalizeBpm(bpm),
    confidence,
    beats: beatTimes.length,
  };
}

async function assertLocalBpmDependencies() {
  await runCommand(ffmpegPath, ["-version"], 10000);
  await runCommand(aubioPath, ["--version"], 10000);
}

async function analyzeTrackLocally(track: any) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mixarr-bpm-"));
  const wavPath = path.join(tempDir, "sample.wav");

  try {
    const server = track.library.server;
    const ratingKey = track.ratingKey || track.plexId;
    const audioUrl = buildPlexTranscodeUrl(server.uri, ratingKey, server.accessToken);
    await extractAudioSample(audioUrl, wavPath);
    return await analyzeBpmWithAubio(wavPath);
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

    for (const track of tracksToProcess) {
      try {
        const deezerBpm = validBpm(await getDeezerBpm(track.artist.title, track.title));
        if (deezerBpm) {
          const tempo = normalizeBpm(deezerBpm);
          await saveTempo(track.id, tempo, "Deezer", 0.9);
          console.log(`[LocalBpmEngine] ${track.artist.title} - ${track.title} -> ${tempo} BPM (Deezer)`);
          if (providerDelayMs > 0) {
            await sleep(providerDelayMs);
          }
          continue;
        }

        const localBpm = await analyzeTrackLocally(track);
        if (localBpm) {
          await saveTempo(track.id, localBpm.tempo, "Aubio local analysis", localBpm.confidence);
          console.log(`[LocalBpmEngine] ${track.artist.title} - ${track.title} -> ${localBpm.tempo} BPM (Aubio, confidence ${localBpm.confidence.toFixed(2)})`);
        } else {
          await saveTempo(track.id, null, "local_not_found", 0);
          console.log(`[LocalBpmEngine] ${track.artist.title} - ${track.title} -> BPM not found`);
        }
      } catch (error: any) {
        console.error(`[LocalBpmEngine] Failed ${track.artist.title} - ${track.title}:`, error.message);
        await saveTempo(track.id, null, "local_not_found", 0).catch(() => undefined);
      }
    }

    console.log("[LocalBpmEngine] BPM backfill completed.");
  } catch (error) {
    console.error("[LocalBpmEngine] Sync failed", error);
  }
};
