import { spawn } from "child_process";
import { existsSync } from "fs";
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import prisma from "./prisma";
import {
  bpmBackfillFilterTrackWhere,
  bpmBackfillTrackWhere,
  bpmAnalyzerFailedTrackWhere,
  bpmExtractionFailedTrackWhere,
  bpmFailedTrackWhere,
  bpmNoDataTrackWhere,
  effectiveBpmTrackWhere,
  explainBpmBackfillEligibility,
  hasLocalEssentiaBpmSuccess,
  missingEffectiveBpmTrackWhere,
  normalizeBpmBackfillFilter,
  pendingBpmBackfillTrackWhere,
  type BpmAnalysisStatus,
  type BpmBackfillFilter,
} from "./bpm";
import { getDeezerBpm } from "./providers/deezer";
import { isRateLimitError } from "./providers/rateLimit";
import {
  resolveDelayMs,
  resolveLimit,
  logMetadataProviderSettings,
  resolveRateLimitBackoff,
  type SyncEngineOptions,
} from "./syncSettings";
import {
  engineBatchSize,
  trackAttemptsTotal,
  trackDurationSeconds,
} from "./metrics";
import { safeTrackBatchIterator, type EnrichmentRunSummary } from "./safeTrackBatch";
import { resolveDbJobConcurrency, runWithConcurrency } from "./concurrency";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const ENGINE = "bpm";

function positiveNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

const sampleWindowSeconds = positiveNumber(process.env.LOCAL_BPM_SAMPLE_SECONDS, 60);
const minimumSampleBytes = positiveNumber(process.env.LOCAL_BPM_MIN_SAMPLE_BYTES, 64 * 1024);
const minimumSampleDurationSeconds = positiveNumber(process.env.LOCAL_BPM_MIN_SAMPLE_SECONDS, 10);
const retryDays = Number(process.env.LOCAL_BPM_RETRY_DAYS || 14);
const confidenceThreshold = Number(process.env.LOCAL_BPM_CONFIDENCE_THRESHOLD || 0.75);
const localBpmAnalysisTimeoutSeconds = positiveNumber(process.env.LOCAL_BPM_ANALYSIS_TIMEOUT_SECONDS, 300);
const localBpmConcurrency = Math.max(1, Math.floor(positiveNumber(process.env.LOCAL_BPM_CONCURRENCY, 1)));
const ffmpegPath = process.env.LOCAL_BPM_FFMPEG_PATH || "ffmpeg";
const ffprobePath = process.env.LOCAL_BPM_FFPROBE_PATH || "ffprobe";
const aubioPath = process.env.LOCAL_BPM_AUBIO_PATH || "aubio";
const essentiaPythonPath = process.env.LOCAL_BPM_ESSENTIA_PYTHON || "/opt/essentia/bin/python";
const bpmTempRoot = process.env.LOCAL_BPM_TEMP_DIR || path.join(os.tmpdir(), "mixarr-bpm");

type LocalBpmAnalyzerMode = "auto" | "essentia" | "aubio";
type LocalBpmAnalyzerName = "essentia" | "aubio";
type LocalBpmAnalysisScope = "windows" | "whole_track";

type CommandResult = {
  stdout: string;
  stderr: string;
};

export type BpmSampleWindow = {
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

type TrackLocalBpmResult = WindowBpmResult & {
  analyzerLabel: string;
  source: string;
};

export type AudioInputSourceType = "local-file" | "plex-direct-download" | "plex-transcode";

export type AudioInputSource = {
  type: AudioInputSourceType;
  input: string;
};

export type AudioSampleValidation = {
  ok: boolean;
  reason?: string;
  failureCode?: "too_short";
  duration?: number;
  sizeBytes?: number;
};

type AudioSampleValidationOptions = {
  minimumDurationSeconds?: number;
};

type ExtractedAudioSample = Required<Pick<AudioSampleValidation, "duration" | "sizeBytes">> & {
  seekMode: "fast" | "accurate";
};

type PlexPart = {
  id?: string | number;
  key?: string;
  file?: string;
};

type LocalBpmAnalyzer = {
  name: LocalBpmAnalyzerName;
  label: string;
  fallbackReason?: string;
  analyze: (wavPath: string, durationSeconds: number) => Promise<LocalBpmResult | null>;
};

const localAnalyzerMode = normalizeAnalyzerMode(process.env.LOCAL_BPM_ANALYZER);
const reprocessAubioWithEssentia = flagEnabled(process.env.LOCAL_BPM_REPROCESS_AUBIO_WITH_ESSENTIA);
const defaultReprocessNoDataFailed = flagEnabled(process.env.LOCAL_BPM_REPROCESS_NO_DATA_FAILED);

const ESSENTIA_BPM_SCRIPT = `
import json
import sys
import warnings

warnings.filterwarnings("ignore")

import essentia.standard as es

audio = es.MonoLoader(filename=sys.argv[1], sampleRate=44100)()
bpm, ticks, confidence, estimates, bpm_intervals = es.RhythmExtractor2013(method="multifeature")(audio)

print(json.dumps({
    "bpm": float(bpm),
    "confidence": float(confidence),
    "beats": len(ticks),
}))
`;

function normalizeAnalyzerMode(value: unknown): LocalBpmAnalyzerMode {
  const normalized = String(value || "auto").trim().toLowerCase();
  return normalized === "essentia" || normalized === "aubio" ? normalized : "auto";
}

function normalizeAnalysisScope(value: unknown): LocalBpmAnalysisScope {
  return String(value || "windows").trim().toLowerCase() === "whole_track" ? "whole_track" : "windows";
}

function flagEnabled(value: unknown) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

class RetryableLocalBpmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableLocalBpmError";
  }
}

class ExtractionFailedBpmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionFailedBpmError";
  }
}

class AnalyzerFailedBpmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzerFailedBpmError";
  }
}

export class ShortTrackBpmError extends Error {
  constructor(
    message: string,
    readonly durationSeconds?: number,
    readonly minimumDurationSeconds = minimumSampleDurationSeconds,
  ) {
    super(message);
    this.name = "ShortTrackBpmError";
  }
}

function isRetryableLocalBpmError(error: unknown) {
  return error instanceof RetryableLocalBpmError;
}

function isExtractionFailedBpmError(error: unknown) {
  return error instanceof ExtractionFailedBpmError;
}

function isAnalyzerFailedBpmError(error: unknown) {
  return error instanceof AnalyzerFailedBpmError;
}

export function isShortTrackBpmError(error: unknown) {
  return error instanceof ShortTrackBpmError;
}

function formatSeconds(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function shortTrackFailureReason(durationSeconds: number, minimumDurationSeconds = minimumSampleDurationSeconds) {
  return `Track duration ${durationSeconds.toFixed(2)}s is below minimum ${formatSeconds(minimumDurationSeconds)}s for local BPM analysis`;
}

export function redactSensitiveUrl(value: string) {
  return value
    .replace(/X-Plex-Token=[^&\]\s)]+/gi, "X-Plex-Token=[redacted]")
    .replace(/transcodeSessionId=[^&\]\s)]+/gi, "transcodeSessionId=[redacted]")
    .replace(/https?:\/\/[^\]\s)]+/gi, "[redacted URL]");
}

function sanitizedErrorMessage(error: unknown) {
  return redactSensitiveUrl(errorMessage(error));
}

function isRetryableFfmpegExtractionError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return [
    "error in the pull function",
    "io error",
    "end of file",
    "session has been invalidated",
    "invalid data found when processing input",
    "server returned",
    "connection reset",
    "connection refused",
    "connection timed out",
    "timed out",
    "tls",
    "http error",
  ].some((fragment) => message.includes(fragment));
}

function isPermanentSourceError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return [
    "server returned 400 bad request",
    "http error 400",
    "error 400",
    "404 not found",
    "server returned 404",
    "no such file",
  ].some((fragment) => message.includes(fragment));
}

export function buildFfmpegSampleArgs(source: AudioInputSource, startSeconds: number, durationSeconds: number, preInputSeek: boolean) {
  const args = [
    "-y",
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
  ];

  if (preInputSeek && startSeconds > 0) {
    args.push("-ss", String(Math.max(0, startSeconds)));
  }

  args.push("-i", source.input);

  if (!preInputSeek && startSeconds > 0) {
    args.push("-ss", String(Math.max(0, startSeconds)));
  }

  args.push(
    "-t",
    String(durationSeconds),
    "-map",
    "0:a:0",
    "-vn",
    "-ac",
    "1",
    "-ar",
    "44100",
    "-sample_fmt",
    "s16",
    "-f",
    "wav",
    "pipe:1",
  );

  return args;
}

export function buildFfmpegFullTrackDecodeArgs(source: AudioInputSource, outputPath: string) {
  return [
    "-hide_banner",
    "-y",
    "-i",
    source.input,
    "-map",
    "0:a:0",
    "-vn",
    "-sn",
    "-dn",
    "-ac",
    "1",
    "-ar",
    "44100",
    "-acodec",
    "pcm_s16le",
    "-f",
    "wav",
    outputPath,
  ];
}

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

function parsePathMappings() {
  const mappings: Array<{ from: string; to: string }> = [];
  const hostPath = process.env.PLEX_MEDIA_PATH_HOST?.trim();
  const containerPath = process.env.MIXARR_MEDIA_PATH_CONTAINER?.trim();

  if (hostPath && containerPath) {
    mappings.push({ from: hostPath, to: containerPath });
  }

  const list = process.env.MIXARR_PATH_MAPPINGS || "";
  for (const mapping of list.split(",")) {
    const trimmed = mapping.trim();
    if (!trimmed) continue;
    const separator = trimmed.lastIndexOf(":");
    if (separator <= 0) continue;
    const from = trimmed.slice(0, separator).trim();
    const to = trimmed.slice(separator + 1).trim();
    if (from && to) mappings.push({ from, to });
  }

  return mappings;
}

function normalizePathForMapping(value: string) {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function mapPlexFilePath(plexFilePath: string | undefined) {
  if (!plexFilePath) return null;
  const normalizedFile = normalizePathForMapping(plexFilePath);

  for (const mapping of parsePathMappings()) {
    const from = normalizePathForMapping(mapping.from);
    const to = normalizePathForMapping(mapping.to);
    if (normalizedFile === from || normalizedFile.startsWith(`${from}/`)) {
      const suffix = normalizedFile.slice(from.length).replace(/^\/+/, "");
      return suffix ? `${to.replace(/\/+$/, "")}/${suffix}` : to;
    }
  }

  return plexFilePath;
}

async function existingLocalMediaPath(plexFilePath: string | undefined) {
  const mapped = mapPlexFilePath(plexFilePath);
  if (!mapped) return null;

  try {
    const fileStats = await stat(mapped);
    return fileStats.isFile() ? mapped : null;
  } catch {
    return null;
  }
}

async function localMediaPathCandidate(plexFilePath: string | undefined) {
  const mapped = mapPlexFilePath(plexFilePath);
  if (!mapped) return null;

  try {
    const fileStats = await stat(mapped);
    return {
      plexFilePath,
      mapped,
      exists: fileStats.isFile(),
      reason: fileStats.isFile() ? "available" : "not a file",
    };
  } catch {
    return {
      plexFilePath,
      mapped,
      exists: false,
      reason: "not found in container",
    };
  }
}

function mediaFileName(filePath: string | undefined) {
  const normalized = filePath?.replace(/\\/g, "/");
  const filename = normalized?.split("/").filter(Boolean).pop();
  return filename || "file";
}

function buildPlexDirectPartUrl(serverUri: string, accessToken: string, part: PlexPart) {
  const partPath = part.key || (part.id ? `/library/parts/${part.id}/${encodeURIComponent(mediaFileName(part.file))}` : null);
  if (!partPath) return null;

  const url = new URL(partPath, serverUri);
  url.searchParams.set("download", "1");
  url.searchParams.set("X-Plex-Token", accessToken);
  return url.toString();
}

async function fetchPlexTrackParts(track: any): Promise<PlexPart[]> {
  const server = track.library.server;
  const ratingKey = track.ratingKey || track.plexId;
  const url = new URL(`/library/metadata/${ratingKey}`, server.uri);
  url.searchParams.set("X-Plex-Token", server.accessToken);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Plex-Client-Identifier": plexClientIdentifier(),
      },
    });

    if (!response.ok) {
      throw new Error(`Plex metadata request returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    const metadata = payload?.MediaContainer?.Metadata?.[0];
    const media = Array.isArray(metadata?.Media) ? metadata.Media : [];
    return media.flatMap((item: any) => Array.isArray(item?.Part) ? item.Part : []);
  } catch (error) {
    console.warn(
      `[LocalBpmEngine] Could not fetch Plex media parts for "${track.artist.title} - ${track.title}": ${sanitizedErrorMessage(error)}`,
    );
    return [];
  }
}

async function buildAudioInputSources(track: any, offsetSeconds: number): Promise<AudioInputSource[]> {
  const server = track.library.server;
  const ratingKey = track.ratingKey || track.plexId;
  const parts = await fetchPlexTrackParts(track);
  const sources: AudioInputSource[] = [];

  for (const part of parts) {
    const localPath = await existingLocalMediaPath(part.file);
    if (localPath) {
      sources.push({ type: "local-file", input: localPath });
      break;
    }
  }

  if (!sources.some((source) => source.type === "local-file")) {
    const candidates = (await Promise.all(parts.map((part) => localMediaPathCandidate(part.file))))
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
    const firstCandidate = candidates[0];

    if (firstCandidate) {
      console.warn(
        `[LocalBpmEngine] No local-file source for "${trackLabel(track)}"; first Plex part maps to "${firstCandidate.mapped}" (${firstCandidate.reason}). Check MIXARR_PATH_MAPPINGS and the Docker media volume mount.`,
      );
    } else if (parts.length > 0) {
      console.warn(
        `[LocalBpmEngine] No local-file source for "${trackLabel(track)}"; Plex media parts did not include file paths. Falling back to Plex URLs.`,
      );
    }
  }

  for (const part of parts) {
    const directUrl = buildPlexDirectPartUrl(server.uri, server.accessToken, part);
    if (directUrl) {
      sources.push({ type: "plex-direct-download", input: directUrl });
      break;
    }
  }

  sources.push({
    type: "plex-transcode",
    input: buildPlexTranscodeUrl(server.uri, ratingKey, server.accessToken, offsetSeconds),
  });

  return sources;
}

export async function buildAudioInputSourcesForTrack(track: any, offsetSeconds = 0): Promise<AudioInputSource[]> {
  return buildAudioInputSources(track, offsetSeconds);
}

function trackLabel(track: any) {
  return `${track.artist.title} - ${track.title}`;
}

function sourceDescription(source: AudioInputSource) {
  if (source.type === "local-file") return `local-file ${source.input}`;
  return source.type;
}

export function runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
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
        const details = (stderr || stdout).trim().slice(0, 2000);
        reject(new Error(`${command} exited with ${code}${details ? `: ${details}` : ""}`));
      }
    });
  });
}

export async function validateAudioSample(
  samplePath: string,
  requestedDurationSeconds?: number,
  options: AudioSampleValidationOptions = {},
): Promise<AudioSampleValidation> {
  if (!existsSync(samplePath)) {
    return { ok: false, reason: "sample file does not exist" };
  }

  let sizeBytes: number;
  try {
    const sampleStats = await stat(samplePath);
    if (!sampleStats.isFile()) return { ok: false, reason: "sample path is not a file" };
    sizeBytes = sampleStats.size;
  } catch (error) {
    return { ok: false, reason: `could not stat sample: ${sanitizedErrorMessage(error)}` };
  }

  if (sizeBytes <= minimumSampleBytes) {
    return {
      ok: false,
      reason: `sample is too small (${sizeBytes} bytes; minimum is ${minimumSampleBytes})`,
      sizeBytes,
    };
  }

  try {
    const probe = await runCommand(ffprobePath, [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=codec_type",
      "-show_entries", "format=duration",
      "-of", "json",
      samplePath,
    ], 30000);
    const payload = JSON.parse(probe.stdout || "{}");
    const hasAudioStream = Array.isArray(payload.streams)
      && payload.streams.some((stream: any) => stream?.codec_type === "audio");
    if (!hasAudioStream) return { ok: false, reason: "ffprobe found no audio stream", sizeBytes };

    const duration = Number(payload.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      return { ok: false, reason: "ffprobe could not read a valid duration", sizeBytes };
    }
    const minimumDurationSeconds = options.minimumDurationSeconds || minimumSampleDurationSeconds;
    if (duration < minimumDurationSeconds) {
      return {
        ok: false,
        reason: `sample duration is too short (${duration.toFixed(2)}s; minimum is ${formatSeconds(minimumDurationSeconds)}s)`,
        failureCode: "too_short",
        duration,
        sizeBytes,
      };
    }
    if (requestedDurationSeconds && requestedDurationSeconds >= 20 && duration < requestedDurationSeconds * 0.75) {
      return {
        ok: false,
        reason: `sample is truncated (${duration.toFixed(2)}s; requested ${requestedDurationSeconds.toFixed(2)}s)`,
        duration,
        sizeBytes,
      };
    }

    return { ok: true, duration, sizeBytes };
  } catch (error) {
    return { ok: false, reason: `ffprobe validation failed: ${sanitizedErrorMessage(error)}`, sizeBytes };
  }
}

export async function decodeAudioSourceToWav(
  source: AudioInputSource,
  outputPath: string,
  timeoutMs = 300000,
  validationOptions: AudioSampleValidationOptions = {},
): Promise<AudioSampleValidation> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await rm(outputPath, { force: true }).catch(() => undefined);
  await runCommand(ffmpegPath, buildFfmpegFullTrackDecodeArgs(source, outputPath), timeoutMs);
  return validateAudioSample(outputPath, undefined, validationOptions);
}

function runCommandToBuffer(command: string, args: string[], timeoutMs: number, maxOutputBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = "";
    let settled = false;

    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectOnce(new Error(`${command} timed out`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += buffer.length;

      if (stdoutBytes > maxOutputBytes) {
        child.kill("SIGKILL");
        rejectOnce(new Error(`${command} produced more than ${maxOutputBytes} bytes`));
        return;
      }

      stdoutChunks.push(buffer);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      rejectOnce(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks, stdoutBytes));
      } else {
        const details = stderr.trim().slice(0, 2000);
        reject(new Error(`${command} exited with ${code}${details ? `: ${details}` : ""}`));
      }
    });
  });
}

function maxWavOutputBytes(durationSeconds: number) {
  return Math.ceil(durationSeconds * 44100 * 2 * 1.25) + 1024 * 1024;
}

function clampSampleStart(startSeconds: number, trackDurationSeconds: number | null, durationSeconds: number) {
  if (!trackDurationSeconds) return Math.max(0, startSeconds);
  return Math.max(0, Math.min(startSeconds, Math.max(0, trackDurationSeconds - durationSeconds)));
}

export function buildBpmSampleWindows(trackDurationMs?: number | null) {
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

async function extractAudioSample(
  source: AudioInputSource,
  outputPath: string,
  startSeconds: number,
  durationSeconds: number,
  displayTrack: string,
  windowLabel: string,
): Promise<ExtractedAudioSample> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await rm(temporaryPath, { force: true }).catch(() => undefined);
  await rm(outputPath, { force: true }).catch(() => undefined);

  const attempts = [
    { preInputSeek: true, seekMode: "fast" as const },
    { preInputSeek: false, seekMode: "accurate" as const },
  ];

  let lastError: unknown = null;

  for (const attempt of attempts) {
    try {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      const sampleBuffer = await runCommandToBuffer(
        ffmpegPath,
        buildFfmpegSampleArgs(source, startSeconds, durationSeconds, attempt.preInputSeek),
        Math.max(localBpmAnalysisTimeoutSeconds * 1000, durationSeconds * 2000),
        maxWavOutputBytes(durationSeconds),
      );

      if (sampleBuffer.length === 0) {
        throw new Error("ffmpeg produced an empty WAV sample");
      }

      await writeFile(temporaryPath, sampleBuffer, { flag: "wx" });
      const validation = await validateAudioSample(temporaryPath, durationSeconds);
      if (!validation.ok || validation.duration === undefined || validation.sizeBytes === undefined) {
        const reason = validation.reason || "unknown validation failure";
        if (validation.failureCode === "too_short" && validation.duration !== undefined) {
          throw new ShortTrackBpmError(shortTrackFailureReason(validation.duration), validation.duration);
        }
        console.warn(
          `[LocalBpmEngine] Invalid BPM sample using ${source.type} for "${displayTrack}" (${windowLabel}, seekMode=${attempt.seekMode}): ${reason}`,
        );
        lastError = new Error(reason);
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        if (attempt.seekMode === "fast") {
          console.warn(
            `[LocalBpmEngine] Retrying ${source.type} for "${displayTrack}" (${windowLabel}) with accurate seek after invalid fast-seek output.`,
          );
        }
        continue;
      }

      await rename(temporaryPath, outputPath);
      return {
        duration: validation.duration,
        sizeBytes: validation.sizeBytes,
        seekMode: attempt.seekMode,
      };
    } catch (error) {
      if (isShortTrackBpmError(error)) throw error;
      lastError = error;
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      if (attempt.preInputSeek && !isPermanentSourceError(error)) {
        console.warn(
          `[LocalBpmEngine] ${source.type} fast seek failed for "${displayTrack}" (${windowLabel}); retrying with accurate seek: ${sanitizedErrorMessage(error)}`,
        );
        continue;
      }

      break;
    }
  }

  await rm(temporaryPath, { force: true }).catch(() => undefined);
  const message = `ffmpeg could not produce a valid BPM sample from ${source.type}: ${sanitizedErrorMessage(lastError)}`;
  if (isRetryableFfmpegExtractionError(lastError)) {
    throw new RetryableLocalBpmError(message);
  }

  throw new Error(message);
}

export async function extractAudioSampleFromSources(
  track: any,
  outputPath: string,
  startSeconds: number,
  durationSeconds: number,
  windowLabel: string,
) {
  const sources = await buildAudioInputSources(track, startSeconds);
  const errors: string[] = [];

  for (const source of sources) {
    const seekStartSeconds = source.type === "plex-transcode" ? 0 : startSeconds;
    console.log(
      `[LocalBpmEngine] Trying ${sourceDescription(source)} for "${trackLabel(track)}" (${windowLabel}).`,
    );

    try {
      const sample = await extractAudioSample(
        source,
        outputPath,
        seekStartSeconds,
        durationSeconds,
        trackLabel(track),
        windowLabel,
      );
      console.log(
        `[LocalBpmEngine] Validated BPM sample using ${source.type} for "${trackLabel(track)}" (${windowLabel}, seekMode=${sample.seekMode}, duration=${sample.duration.toFixed(2)}s, size=${sample.sizeBytes} bytes).`,
      );
      return source.type;
    } catch (error) {
      if (isShortTrackBpmError(error)) {
        throw error;
      }
      const message = sanitizedErrorMessage(error);
      errors.push(`${source.type}: ${message}`);
      console.warn(
        `[LocalBpmEngine] ${source.type} sample failed for "${trackLabel(track)}" (${windowLabel}): ${message}`,
      );
    }
  }

  throw new ExtractionFailedBpmError(
    `No BPM sample could be extracted for "${trackLabel(track)}" (${windowLabel}). Sources tried: ${errors.join(" | ") || "none"}`,
  );
}

async function createBpmTempDir() {
  await mkdir(bpmTempRoot, { recursive: true });
  return mkdtemp(path.join(bpmTempRoot, "sample-"));
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

async function analyzeBpmWithEssentia(wavPath: string): Promise<LocalBpmResult | null> {
  const result = await runCommand(essentiaPythonPath, ["-c", ESSENTIA_BPM_SCRIPT, wavPath], 180000);
  const outputLines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  const jsonLine = outputLines[outputLines.length - 1];
  if (!jsonLine) return null;

  const payload = JSON.parse(jsonLine);
  const bpm = validBpm(payload.bpm);
  if (!bpm) return null;

  const confidence = Number(payload.confidence);
  const beats = Number(payload.beats);

  return {
    tempo: normalizeBpm(bpm),
    confidence: Math.max(0.5, Math.min(0.95, Number.isFinite(confidence) ? confidence : 0.65)),
    beats: Number.isFinite(beats) ? beats : 0,
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

function aubioAnalyzer(fallbackReason?: string): LocalBpmAnalyzer {
  return {
    name: "aubio",
    label: "Aubio",
    fallbackReason,
    analyze: analyzeBpmWithAubio,
  };
}

function essentiaAnalyzer(): LocalBpmAnalyzer {
  return {
    name: "essentia",
    label: "Essentia",
    analyze: (wavPath) => analyzeBpmWithEssentia(wavPath),
  };
}

async function assertAubioAvailable() {
  await runCommand(aubioPath, ["--version"], 10000);
}

export async function assertEssentiaAvailable() {
  await runCommand(essentiaPythonPath, [
    "-c",
    "import essentia.standard as es; print('essentia ok')",
  ], 10000);
}

async function resolveLocalBpmAnalyzer(): Promise<LocalBpmAnalyzer> {
  await runCommand(ffmpegPath, ["-version"], 10000);
  await runCommand(ffprobePath, ["-version"], 10000);

  if (localAnalyzerMode === "aubio") {
    await assertAubioAvailable();
    return aubioAnalyzer();
  }

  if (localAnalyzerMode === "auto" && os.arch() === "arm64") {
    await assertAubioAvailable();
    return aubioAnalyzer("Essentia skipped on arm64");
  }

  try {
    await assertEssentiaAvailable();
    return essentiaAnalyzer();
  } catch (error) {
    const fallbackReason = `Essentia unavailable (${errorMessage(error)})`;
    await assertAubioAvailable();
    return aubioAnalyzer(fallbackReason);
  }
}

function tempoSourceForAnalyzer(analyzer: LocalBpmAnalyzer, scope: LocalBpmAnalysisScope) {
  if (analyzer.name === "essentia") {
    return scope === "whole_track"
      ? "Essentia local whole-track analysis"
      : "Essentia local multi-window analysis";
  }

  return scope === "whole_track"
    ? "Aubio local whole-track analysis"
    : "Aubio local multi-window analysis";
}

async function analyzeTrackWindows(track: any, tempDir: string, analyzer: LocalBpmAnalyzer) {
  const trackDurationSeconds = track.duration ? Number(track.duration) / 1000 : null;
  if (trackDurationSeconds !== null && trackDurationSeconds < minimumSampleDurationSeconds) {
    throw new ShortTrackBpmError(shortTrackFailureReason(trackDurationSeconds), trackDurationSeconds);
  }

  const sampleWindows = buildBpmSampleWindows(track.duration);
  const results: WindowBpmResult[] = [];
  let extractedWindowCount = 0;
  const extractionErrors: string[] = [];
  let analyzerCompletedCount = 0;
  const analyzerErrors: string[] = [];

  for (let index = 0; index < sampleWindows.length; index++) {
    const sampleWindow = sampleWindows[index];
    const wavPath = path.join(tempDir, `sample-${index}.wav`);
    try {
      await extractAudioSampleFromSources(
        track,
        wavPath,
        sampleWindow.startSeconds,
        sampleWindow.durationSeconds,
        sampleWindow.label,
      );
      extractedWindowCount += 1;
    } catch (error) {
      if (isShortTrackBpmError(error)) throw error;
      extractionErrors.push(sanitizedErrorMessage(error));
      console.warn(
        `[LocalBpmEngine] Skipping ${sampleWindow.label} sample for "${trackLabel(track)}": ${sanitizedErrorMessage(error)}`,
      );
      continue;
    }

    let bpm: LocalBpmResult | null;
    try {
      bpm = await analyzer.analyze(wavPath, sampleWindow.durationSeconds);
      analyzerCompletedCount += 1;
    } catch (error) {
      const message = sanitizedErrorMessage(error);
      analyzerErrors.push(`${sampleWindow.label}: ${message}`);
      console.warn(
        `[LocalBpmEngine] ${analyzer.label} failed for validated ${sampleWindow.label} sample from "${trackLabel(track)}"; trying the next window: ${message}`,
      );
      continue;
    }
    if (bpm) {
      results.push({
        ...bpm,
        windowLabel: sampleWindow.label,
      });
    }
  }

  const combined = combineWindowResults(results, sampleWindows.length);
  if (!combined) {
    if (extractedWindowCount === 0) {
      throw new ExtractionFailedBpmError(
        `No BPM sample windows could be extracted for "${trackLabel(track)}". ${extractionErrors.join(" | ")}`,
      );
    }

    if (analyzerCompletedCount === 0 && analyzerErrors.length > 0) {
      throw new AnalyzerFailedBpmError(
        `${analyzer.label} failed for every validated sample window from "${trackLabel(track)}". ${analyzerErrors.join(" | ")}`,
      );
    }

    return null;
  }

  return {
    ...combined,
    analyzerLabel: analyzer.label,
    source: tempoSourceForAnalyzer(analyzer, "windows"),
  };
}

async function analyzeTrackWholeTrack(track: any, tempDir: string, analyzer: LocalBpmAnalyzer) {
  const trackDurationSeconds = track.duration ? track.duration / 1000 : null;
  if (!trackDurationSeconds) {
    console.warn(
      `[LocalBpmEngine] Whole-track analysis requested for "${track.artist.title} - ${track.title}" but duration is missing; using windows.`,
    );
    return analyzeTrackWindows(track, tempDir, analyzer);
  }
  if (trackDurationSeconds < minimumSampleDurationSeconds) {
    throw new ShortTrackBpmError(shortTrackFailureReason(trackDurationSeconds), trackDurationSeconds);
  }

  const wavPath = path.join(tempDir, "whole-track.wav");

  await extractAudioSampleFromSources(track, wavPath, 0, trackDurationSeconds, "whole track");

  let bpm: LocalBpmResult | null;
  try {
    bpm = await analyzer.analyze(wavPath, trackDurationSeconds);
  } catch (error) {
    throw new AnalyzerFailedBpmError(
      `${analyzer.label} failed for validated whole-track sample from "${trackLabel(track)}": ${sanitizedErrorMessage(error)}`,
    );
  }
  if (!bpm) return null;

  return {
    ...bpm,
    windowLabel: "whole track",
    analyzerLabel: analyzer.label,
    source: tempoSourceForAnalyzer(analyzer, "whole_track"),
  };
}

async function analyzeTrackLocally(
  track: any,
  analyzer: LocalBpmAnalyzer,
  analysisScope: LocalBpmAnalysisScope,
): Promise<TrackLocalBpmResult | null> {
  const tempDir = await createBpmTempDir();

  try {
    // We must await here so that the finally cleanup runs after the analysis
    // finishes writing its WAV samples. A bare `return promise` would let the
    // finally delete the temp dir first, and the still-running extraction would
    // re-create and fill it with nothing left to clean it up afterward.
    if (analysisScope === "whole_track") {
      return await analyzeTrackWholeTrack(track, tempDir, analyzer);
    }

    return await analyzeTrackWindows(track, tempDir, analyzer);
  } finally {
    const removedBytes = await directorySize(tempDir).catch(() => 0);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    console.log(`[LocalBpmEngine] Temp cleanup for track ${trackLabel(track)} removed ${formatBytes(removedBytes)}.`);
  }
}

async function directorySize(dirPath: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(entryPath);
    } else if (entry.isFile()) {
      total += (await stat(entryPath)).size;
    }
  }
  return total;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function canonicalBpmSource(source: string) {
  const normalized = source.toLowerCase();
  if (normalized.includes("essentia") || normalized.includes("aubio")) return "local_essentia";
  if (normalized.includes("deezer") || normalized === "api") return "api";
  return source.trim() || "unknown";
}

export function effectiveBpmFromSources(input: {
  apiBpm: number | null;
  localBpm: number | null;
  importedBpm: number | null;
  preferLocal: boolean;
}) {
  const ordered = input.preferLocal
    ? [
      { value: input.localBpm, source: "local_essentia" },
      { value: input.apiBpm, source: "api" },
      { value: input.importedBpm, source: "imported" },
    ]
    : [
      { value: input.apiBpm, source: "api" },
      { value: input.importedBpm, source: "imported" },
      { value: input.localBpm, source: "local_essentia" },
    ];
  return ordered.find((candidate) => validBpm(candidate.value) !== null) || { value: null, source: "none" };
}

async function logSavedBpm(trackId: string) {
  const saved = await prisma.track.findUnique({
    where: { id: trackId },
    select: {
      id: true,
      title: true,
      artist: { select: { title: true } },
      bpm: true,
      bpmSource: true,
      bpmConfidence: true,
      bpmAnalyzedAt: true,
      bpmAnalysisStatus: true,
      audioFeature: {
        select: {
          tempo: true,
          tempoSource: true,
          tempoConfidence: true,
        },
      },
    },
  });

  console.log("[LocalBpmEngine] Saved BPM:", saved);
}

async function saveBpmSuccess(
  trackId: string,
  tempo: number,
  source: string,
  confidence: number,
  options: {
    provider: "api" | "local_essentia";
    preferLocal: boolean;
    analysisScope: LocalBpmAnalysisScope;
  },
) {
  const bpm = validBpm(tempo);
  if (!bpm) {
    throw new Error(`Refusing to persist invalid BPM value: ${tempo}`);
  }

  const analyzedAt = new Date();
  const bpmSource = canonicalBpmSource(source);
  const existing = await prisma.track.findUnique({
    where: { id: trackId },
    select: {
      bpm: true,
      bpmSource: true,
      bpmConfidence: true,
      apiBpm: true,
      localBpm: true,
    },
  });
  const existingSource = canonicalBpmSource(String(existing?.bpmSource || ""));
  const importedBpm = existingSource !== "api" && existingSource !== "local_essentia"
    ? validBpm(existing?.bpm)
    : null;
  const apiBpm = options.provider === "api" ? bpm : validBpm(existing?.apiBpm);
  const localBpm = options.provider === "local_essentia" ? bpm : validBpm(existing?.localBpm);
  const effective = effectiveBpmFromSources({
    apiBpm,
    localBpm,
    importedBpm,
    preferLocal: options.preferLocal,
  });
  const effectiveBpm = validBpm(effective.value);
  const effectiveConfidence = effective.source === options.provider
    ? confidence
    : effective.source === existingSource
      ? existing?.bpmConfidence ?? confidence
      : confidence;

  console.log(
    `[LocalBpmEngine] Persisting BPM for track ${trackId}: ${bpm} BPM (${bpmSource}, confidence ${confidence.toFixed(2)}); effective source=${effective.source} value=${effectiveBpm ?? "null"}`,
  );

  try {
    await prisma.$transaction([
      prisma.track.update({
        where: { id: trackId },
        data: {
          bpm: effectiveBpm,
          apiBpm,
          localBpm,
          effectiveBpm,
          bpmSource: effective.source,
          bpmConfidence: effectiveConfidence,
          bpmAnalyzedAt: analyzedAt,
          bpmAnalysisStatus: "success",
          bpmAnalysisScope: options.analysisScope,
          bpmFailureReason: null,
        },
        select: { id: true },
      }),
      prisma.audioFeature.upsert({
        where: { trackId },
        update: {
          tempo: effectiveBpm,
          tempoSource: source,
          tempoConfidence: effectiveConfidence,
          lastUpdated: analyzedAt,
        },
        create: {
          trackId,
          tempo: effectiveBpm,
          tempoSource: source,
          tempoConfidence: effectiveConfidence,
          source,
          confidence: effectiveConfidence,
          lastUpdated: analyzedAt,
        },
      }),
    ]);
  } catch (error) {
    console.error(`[LocalBpmEngine] Failed to persist BPM for track ${trackId}:`, error);
    throw error;
  }

  try {
    await logSavedBpm(trackId);
  } catch (error) {
    console.error(`[LocalBpmEngine] Failed to verify saved BPM for track ${trackId}:`, error);
  }
}

async function saveBpmAttemptWithoutResult(
  trackId: string,
  source: string,
  status: Exclude<BpmAnalysisStatus, "success">,
  failureReason?: string,
  analysisScope?: LocalBpmAnalysisScope,
) {
  const analyzedAt = new Date();
  const bpmSource = canonicalBpmSource(source);

  console.log(`[LocalBpmEngine] Persisting BPM ${status} marker for track ${trackId} (${bpmSource})`);

  try {
    await prisma.$transaction([
      prisma.track.update({
        where: { id: trackId },
        data: {
          bpmSource,
          bpmConfidence: 0,
          bpmAnalyzedAt: analyzedAt,
          bpmAnalysisStatus: status,
          bpmAnalysisScope: analysisScope,
          bpmFailureReason: failureReason || (status === "no_data" ? "Analysis completed but no BPM was found." : null),
        },
        select: { id: true },
      }),
      prisma.audioFeature.upsert({
        where: { trackId },
        update: {
          tempo: null,
          tempoSource: source,
          tempoConfidence: 0,
          lastUpdated: analyzedAt,
        },
        create: {
          trackId,
          tempo: null,
          tempoSource: source,
          tempoConfidence: 0,
          source,
          confidence: 0,
          lastUpdated: analyzedAt,
        },
      }),
    ]);
  } catch (error) {
    console.error(`[LocalBpmEngine] Failed to persist BPM ${status} marker for track ${trackId}:`, error);
    throw error;
  }
}

function isAubioTempoSource(source: unknown) {
  return typeof source === "string" && source.startsWith("Aubio");
}

function hasExistingAubioTempo(track: any) {
  return isAubioTempoSource(track.audioFeature?.tempoSource) && validBpm(track.audioFeature?.tempo) !== null;
}

const bpmProcessingTrackSelect = {
  id: true,
  title: true,
  plexId: true,
  ratingKey: true,
  duration: true,
  bpm: true,
  apiBpm: true,
  localBpm: true,
  effectiveBpm: true,
  bpmSource: true,
  bpmConfidence: true,
  bpmAnalysisStatus: true,
  artist: { select: { title: true } },
  library: {
    select: {
      id: true,
      name: true,
      server: { select: { uri: true, accessToken: true } },
    },
  },
  audioFeature: { select: { tempo: true, tempoSource: true, tempoConfidence: true } },
} as const;

async function logBpmBackfillQueueStats(
  where: ReturnType<typeof bpmBackfillTrackWhere>,
  includeAubioReprocess: boolean,
  retryNoDataFailed: boolean,
  reprocessApiWithLocal: boolean,
  filter: BpmBackfillFilter,
  force: boolean,
) {
  const active = { syncStatus: "active" } as const;

  const [
    total,
    withBpm,
    missing,
    pending,
    noData,
    failed,
    extractionFailed,
    analyzerFailed,
    candidates,
  ] = await runWithConcurrency([
    () => prisma.track.count({ where: active }),
    () => prisma.track.count({ where: { AND: [active, effectiveBpmTrackWhere()] } }),
    () => prisma.track.count({ where: { AND: [active, missingEffectiveBpmTrackWhere()] } }),
    () => prisma.track.count({ where: { AND: [active, pendingBpmBackfillTrackWhere()] } }),
    () => prisma.track.count({ where: { AND: [active, bpmNoDataTrackWhere()] } }),
    () => prisma.track.count({ where: { AND: [active, bpmFailedTrackWhere()] } }),
    () => prisma.track.count({ where: { AND: [active, bpmExtractionFailedTrackWhere()] } }),
    () => prisma.track.count({ where: { AND: [active, bpmAnalyzerFailedTrackWhere()] } }),
    () => prisma.track.count({ where }),
  ], resolveDbJobConcurrency());

  console.log(
    `[LocalBpmEngine] Queue status: filter=${filter}, force=${force ? "on" : "off"}, total=${total}, withBpm=${withBpm}, missing=${missing}, pending=${pending}, noData=${noData}, failed=${failed}, extractionFailed=${extractionFailed}, analyzerFailed=${analyzerFailed}, candidates=${candidates}, retryNoDataFailed=${retryNoDataFailed ? "on" : "off"}, reprocessAubio=${includeAubioReprocess ? "on" : "off"}, reprocessApi=${reprocessApiWithLocal ? "on" : "off"}.`,
  );
}

async function logInitialBpmCandidateReasons(
  where: ReturnType<typeof bpmBackfillTrackWhere>,
  options: {
    includeAubioReprocess: boolean;
    retryNoDataFailed: boolean;
    reprocessApiWithLocal: boolean;
    filter?: unknown;
    force?: boolean;
  },
) {
  await safeTrackBatchIterator<any>({
    engineName: "LocalBpmEngine candidate logger",
    where,
    orderBy: [{ addedAt: "desc" }, { id: "asc" }],
    take: 10,
    select: bpmProcessingTrackSelect,
    process: async (track) => {
      const explanation = explainBpmBackfillEligibility(track, options);
      console.log(
        `[LocalBpmEngine] Candidate reason for ${track.artist.title} - ${track.title}: ` +
        `bpm=${explanation.bpm ?? "null"} localBpm=${explanation.localBpm ?? "null"} apiBpm=${explanation.apiBpm ?? "null"} ` +
        `bpmSource=${explanation.bpmSource ?? "null"} bpmAnalysisStatus=${explanation.bpmAnalysisStatus ?? "null"} ` +
        `audioFeatureTempo=${explanation.audioFeatureTempo ?? "null"} audioFeatureTempoSource=${explanation.audioFeatureTempoSource ?? "null"} ` +
        `effectiveBpm=${explanation.effectiveBpm ?? "null"} selected=${explanation.selected} reason=${explanation.reason}`,
      );
      if (hasLocalEssentiaBpmSuccess(track)) {
        console.error("[LocalBpmEngine] BUG: selected track already has local_essentia success BPM.");
      }
      return "processed";
    },
  });
}

export const runLocalBpmEngine = async (options: SyncEngineOptions = {}) => {
  let summary: EnrichmentRunSummary = { attempted: 0, processed: 0, skipped: 0, failed: 0 };

  try {
    const metadataSettings = logMetadataProviderSettings(options).bpm;
    const force = !!options.bpmBackfillForce;
    const filter = normalizeBpmBackfillFilter(options.bpmBackfillFilter, { force });
    const provider = !metadataSettings.api && metadataSettings.local
      ? "local"
      : metadataSettings.api && !metadataSettings.local
        ? "api"
        : "configured";
    console.log(`[LocalBpmEngine] Starting BPM backfill filter=${filter} force=${force} provider=${provider}`);
    if (!metadataSettings.api && !metadataSettings.local) {
      console.log("[LocalBpmEngine] BPM providers are disabled; skipping BPM backfill.");
      return summary;
    }
    if (!metadataSettings.api && metadataSettings.local) {
      console.log("[LocalBpmEngine] API BPM disabled; using local Essentia for BPM backfill.");
    }
    if (!metadataSettings.local) {
      console.log("[LocalBpmEngine] Skipping local BPM because ENABLE_LOCAL_BPM=false.");
    }
    const batchSize = resolveLimit(options.bpmBatchSize, "LOCAL_BPM_BATCH_SIZE");
    const providerDelayMs = resolveDelayMs(options.providerDelayMs, 250);
    const rateLimitBackoffEnabled = resolveRateLimitBackoff(options.rateLimitBackoffEnabled);
    const localAnalyzer = metadataSettings.local ? await resolveLocalBpmAnalyzer() : null;
    const includeAubioReprocess = localAnalyzer?.name === "essentia" && reprocessAubioWithEssentia;
    const retryNoDataFailed = options.bpmReprocessNoDataFailed ?? defaultReprocessNoDataFailed;
    const localAnalysisScope = metadataSettings.scope;

    console.log(
      `[LocalBpmEngine] Local analyzer selected: ${localAnalyzer?.label || "disabled"} (requested ${localAnalyzerMode}); scope=${localAnalysisScope}; reprocessAubio=${includeAubioReprocess ? "on" : "off"}; reprocessNoDataFailed=${retryNoDataFailed ? "on" : "off"}.`,
    );
    if (localAnalysisScope === "whole_track") {
      console.log(`[LocalBpmEngine] Whole-track mode uses concurrency=${localBpmConcurrency}.`);
    }
    if (localAnalyzer?.fallbackReason) {
      console.warn(`[LocalBpmEngine] Local analyzer fallback: ${localAnalyzer.fallbackReason}; using ${localAnalyzer.label}.`);
    }

    const eligibilityOptions = {
      includeAubioReprocess,
      retryNoDataFailed,
      reprocessApiWithLocal: metadataSettings.reprocessApiWithLocal,
      filter,
      force,
    };
    const extraScope: any[] = [];
    if (options.bpmBackfillLibraryId || options.bpmBackfillUserId) {
      extraScope.push({
        library: {
          ...(options.bpmBackfillLibraryId ? { id: options.bpmBackfillLibraryId } : {}),
          ...(options.bpmBackfillUserId ? { server: { userId: options.bpmBackfillUserId } } : {}),
        },
      });
    }
    if (options.bpmBackfillTrackIds?.length) {
      extraScope.push({ id: { in: options.bpmBackfillTrackIds } });
    }
    const unscopedWhere = bpmBackfillTrackWhere(eligibilityOptions);
    const where = extraScope.length ? { AND: [unscopedWhere, ...extraScope] } : unscopedWhere;
    const targetWhere = extraScope.length
      ? { AND: [{ syncStatus: "active" }, bpmBackfillFilterTrackWhere(filter), ...extraScope] }
      : { AND: [{ syncStatus: "active" }, bpmBackfillFilterTrackWhere(filter)] };
    await logBpmBackfillQueueStats(where, includeAubioReprocess, retryNoDataFailed, metadataSettings.reprocessApiWithLocal, filter, force);
    const targetCount = await prisma.track.count({ where: targetWhere });
    const candidateCount = await prisma.track.count({ where });
    const filterLabel = filter === "api_bpm"
      ? "API BPM tracks eligible for local reprocess"
      : filter === "imported_legacy_bpm"
        ? "imported/legacy BPM tracks eligible for local reprocess"
        : "tracks needing BPM backfill";
    console.log(`[LocalBpmEngine] Found ${candidateCount} ${filterLabel}.`);
    if (candidateCount === 0) {
      console.log(
        `[LocalBpmEngine] No BPM candidates selected: filter=${filter}, targetCount=${targetCount}, force=${force}, provider=${provider}, localEnabled=${metadataSettings.local}, apiEnabled=${metadataSettings.api}.`,
      );
    }
    await logInitialBpmCandidateReasons(where, eligibilityOptions);
    engineBatchSize.observe({ engine: ENGINE }, Math.min(candidateCount, batchSize || candidateCount));

    summary = await safeTrackBatchIterator<any>({
      engineName: "LocalBpmEngine",
      where,
      orderBy: [{ addedAt: "desc" }, { id: "asc" }],
      select: bpmProcessingTrackSelect,
      ...(batchSize ? { take: batchSize } : {}),
      process: async (track) => {
        const currentTrack = await prisma.track.findFirst({
          where: { AND: [{ id: track.id }, where] },
          select: bpmProcessingTrackSelect,
        });
        if (!currentTrack) {
          const latest = await prisma.track.findUnique({
            where: { id: track.id },
            select: bpmProcessingTrackSelect,
          });
          if (latest) {
            const explanation = explainBpmBackfillEligibility(latest, eligibilityOptions);
            console.log(
              `[LocalBpmEngine] Skipping ${latest.artist.title} - ${latest.title}; no longer eligible for BPM backfill. ` +
              `effectiveBpm=${explanation.effectiveBpm ?? "null"} bpmSource=${explanation.bpmSource ?? "null"} ` +
              `bpmAnalysisStatus=${explanation.bpmAnalysisStatus ?? "null"} reason=${explanation.reason}`,
            );
          }
          return "skipped";
        }
        track = currentTrack;
        let outcome: "success" | "not_found" | "rate_limited" | "error" = "success";
        const endTimer = trackDurationSeconds.startTimer({ engine: ENGINE });
        const preserveExistingAubio = localAnalyzer?.name === "essentia" && hasExistingAubioTempo(track);
        try {
          let deezerRateLimited = false;
          let deezerBpm = null;

        if (metadataSettings.api) {
          try {
            deezerBpm = validBpm(await getDeezerBpm(track.artist.title, track.title));
          } catch (error) {
            if (!isRateLimitError(error) || rateLimitBackoffEnabled) throw error;
            deezerRateLimited = true;
            console.warn(
              `[LocalBpmEngine] Deezer rate-limited for "${track.artist.title} - ${track.title}"; trying local analysis.`,
            );
          }
        }

        if (deezerBpm && !metadataSettings.preferLocal) {
          const tempo = normalizeBpm(deezerBpm);
          await saveBpmSuccess(track.id, tempo, "Deezer", 0.9, {
            provider: "api",
            preferLocal: metadataSettings.preferLocal,
            analysisScope: localAnalysisScope,
          });
          console.log(`[LocalBpmEngine] ${track.artist.title} - ${track.title} -> ${tempo} BPM (Deezer)`);
          return "processed";
        }

        const localBpm = localAnalyzer ? await analyzeTrackLocally(track, localAnalyzer, localAnalysisScope) : null;
        if (localBpm) {
          await saveBpmSuccess(track.id, localBpm.tempo, localBpm.source, localBpm.confidence, {
            provider: "local_essentia",
            preferLocal: metadataSettings.preferLocal,
            analysisScope: localAnalysisScope,
          });
          console.log(`[LocalBpmEngine] ${track.artist.title} - ${track.title} -> ${localBpm.tempo} BPM (${localBpm.analyzerLabel} ${localBpm.windowLabel}, confidence ${localBpm.confidence.toFixed(2)})`);
        } else if (deezerBpm) {
          const tempo = normalizeBpm(deezerBpm);
          await saveBpmSuccess(track.id, tempo, "Deezer", 0.9, {
            provider: "api",
            preferLocal: metadataSettings.preferLocal,
            analysisScope: localAnalysisScope,
          });
          console.log(`[LocalBpmEngine] ${track.artist.title} - ${track.title} -> ${tempo} BPM (Deezer)`);
        } else if (deezerRateLimited) {
          outcome = "rate_limited";
          console.warn(
            `[LocalBpmEngine] Deezer was rate-limited and local analysis found no BPM for "${track.artist.title} - ${track.title}"; leaving it queued.`,
          );
        } else if (preserveExistingAubio) {
          outcome = "not_found";
          console.warn(
            `[LocalBpmEngine] Essentia found no replacement BPM for "${track.artist.title} - ${track.title}"; keeping existing Aubio BPM.`,
          );
          const existingAubioTempo = validBpm(track.audioFeature?.tempo);
          if (!validBpm(track.bpm) && existingAubioTempo) {
            await saveBpmSuccess(track.id, existingAubioTempo, track.audioFeature?.tempoSource || "Aubio", track.audioFeature?.tempoConfidence || 0.7, {
              provider: "local_essentia",
              preferLocal: metadataSettings.preferLocal,
              analysisScope: localAnalysisScope,
            });
          }
        } else {
          await saveBpmAttemptWithoutResult(track.id, metadataSettings.local ? "local_not_found" : "api_not_found", "no_data", undefined, localAnalysisScope);
          console.log(`[LocalBpmEngine] ${track.artist.title} - ${track.title} -> BPM not found`);
          outcome = "not_found";
        }
      } catch (error: any) {
        if (isRateLimitError(error)) {
          // Deezer was rate-limited. Don't fall through to local Aubio
          // analysis and don't write a not_found marker — both would
          // lock this track into a worse data source for the next 14
          // days when Deezer might have the canonical BPM available
          // the moment the rate-limit window rolls off.
          outcome = "rate_limited";
          console.warn(
            `[LocalBpmEngine] Rate-limited while looking up "${track.artist.title} - ${track.title}" (${error.message}); leaving it queued.`,
          );
        } else if (isExtractionFailedBpmError(error)) {
          outcome = "error";
          console.error(`[LocalBpmEngine] Extraction failed ${track.artist.title} - ${track.title}:`, sanitizedErrorMessage(error));
          if (preserveExistingAubio) {
            console.warn(
              `[LocalBpmEngine] Keeping existing Aubio BPM for "${track.artist.title} - ${track.title}" after extraction failed.`,
            );
          } else {
            await saveBpmAttemptWithoutResult(track.id, "local_extraction_failed", "extraction_failed", sanitizedErrorMessage(error));
          }
        } else if (isShortTrackBpmError(error)) {
          outcome = "not_found";
          const reason = sanitizedErrorMessage(error);
          console.warn(`[LocalBpmEngine] Short track skipped: ${track.artist.title} - ${track.title} ${reason}`);
          if (!preserveExistingAubio) {
            await saveBpmAttemptWithoutResult(track.id, "local_too_short", "too_short", reason, localAnalysisScope);
          }
        } else if (isRetryableLocalBpmError(error)) {
          outcome = "error";
          console.warn(
            `[LocalBpmEngine] Transient local BPM extraction failure for "${track.artist.title} - ${track.title}"; leaving it queued: ${sanitizedErrorMessage(error)}`,
          );
        } else if (isAnalyzerFailedBpmError(error)) {
          outcome = "error";
          console.error(`[LocalBpmEngine] Analyzer failed ${track.artist.title} - ${track.title}:`, sanitizedErrorMessage(error));
          if (preserveExistingAubio) {
            console.warn(
              `[LocalBpmEngine] Keeping existing Aubio BPM for "${track.artist.title} - ${track.title}" after Essentia failed.`,
            );
          } else {
            await saveBpmAttemptWithoutResult(track.id, "local_analyzer_failed", "analyzer_failed", sanitizedErrorMessage(error));
          }
        } else {
          console.error(`[LocalBpmEngine] Failed ${track.artist.title} - ${track.title}:`, sanitizedErrorMessage(error));
          outcome = "error";
        }
      } finally {
        endTimer();
        trackAttemptsTotal.inc({ engine: ENGINE, result: outcome });
      }

        if (providerDelayMs > 0) await sleep(providerDelayMs);
        return outcome === "error" ? "failed" : "processed";
      },
    });

    console.log(`[LocalBpmEngine] BPM backfill completed. attempted=${summary.attempted}, processed=${summary.processed}, skipped=${summary.skipped}, failed=${summary.failed}.`);
  } catch (error) {
    console.error(`[LocalBpmEngine] Sync failed: ${sanitizedErrorMessage(error)}`);
  }
  return summary;
};
