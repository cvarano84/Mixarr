import { mkdir, mkdtemp, readdir, rm, stat } from "fs/promises";
import os from "os";
import path from "path";
import prisma from "./prisma";
import {
  assertEssentiaAvailable,
  buildAudioInputSourcesForTrack,
  buildBpmSampleWindows,
  decodeAudioSourceToWav,
  extractAudioSampleFromSources,
  isShortTrackBpmError,
  redactSensitiveUrl,
  runCommand,
  validateAudioSample,
  type AudioInputSource,
  type ShortTrackBpmError,
} from "./localBpmEngine";
import {
  completeAudioFeatureWhere,
  getEffectiveAudioFeatures,
  localEssentiaAudioFeatureSuccessTrackWhere,
  missingAudioFeatureTrackWhere,
  type AudioFeatureStatus,
} from "./audioFeatures";
import {
  resolveDelayMs,
  resolveLimit,
  logMetadataProviderSettings,
  type SyncEngineOptions,
} from "./syncSettings";
import {
  engineBatchSize,
  trackAttemptsTotal,
  trackDurationSeconds,
} from "./metrics";
import { safeTrackBatchIterator, type EnrichmentRunSummary } from "./safeTrackBatch";
import { resolveDbJobConcurrency, runWithConcurrency } from "./concurrency";
import { acquireJobLock } from "./jobLock";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const ENGINE = "audio_feature";
const LOCAL_AUDIO_FEATURE_JOB_KEY = "audio_feature:local";
const essentiaPythonPath = process.env.LOCAL_BPM_ESSENTIA_PYTHON || "/opt/essentia/bin/python";
const featureTempRoot = process.env.LOCAL_AUDIO_FEATURE_TEMP_DIR || path.join(os.tmpdir(), "mixarr-audio-features");

const localAudioFeatureGlobals = globalThis as typeof globalThis & {
  mixarrLocalAudioFeatureShutdownRequested?: boolean;
  mixarrLocalAudioFeatureSignalHandlersInstalled?: boolean;
};

function positiveNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function formatSeconds(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

const minimumAudioFeatureDurationSeconds = positiveNumber(process.env.LOCAL_AUDIO_FEATURES_MIN_DURATION_SECONDS, 10);
const localAudioFeatureAnalysisTimeoutSeconds = positiveNumber(process.env.LOCAL_AUDIO_FEATURES_ANALYSIS_TIMEOUT_SECONDS, 300);
const localAudioFeatureConcurrency = Math.max(1, Math.floor(positiveNumber(process.env.LOCAL_AUDIO_FEATURES_CONCURRENCY, 1)));
const allowShortWholeTrackAnalysis = boolSetting(undefined, "LOCAL_AUDIO_FEATURES_ALLOW_SHORT_TRACKS", false);

export type LocalAudioFeatureAnalysisScope = "windows" | "whole_track";

type LocalAudioFeatureWindowResult = {
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  tempo: number | null;
  tempoConfidence: number;
  loudness: number | null;
  dynamicComplexity: number | null;
  key: string | null;
  scale: string | null;
  keyStrength: number | null;
  spectralCentroid: number | null;
  spectralContrast: number | null;
  rhythmStability: number | null;
  onsetRate: number | null;
  zeroCrossingRate: number | null;
  replayGain: number | null;
  confidence: number;
};

type LocalAudioFeatureResult = LocalAudioFeatureWindowResult & {
  windowCount: number;
  sourceTypes: string[];
  analysisScope: LocalAudioFeatureAnalysisScope;
};

class ExtractionFailedAudioFeatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionFailedAudioFeatureError";
  }
}

class AnalyzerFailedAudioFeatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzerFailedAudioFeatureError";
  }
}

class ShortTrackAudioFeatureError extends Error {
  constructor(
    message: string,
    readonly durationSeconds: number,
    readonly minimumDurationSeconds: number,
    readonly sourceType?: string,
  ) {
    super(message);
    this.name = "ShortTrackAudioFeatureError";
  }
}

function boolSetting(userValue: boolean | null | undefined, envName: string, defaultValue: boolean) {
  if (typeof userValue === "boolean") return userValue;
  const envValue = process.env[envName];
  if (envValue === undefined) return defaultValue;
  return ["1", "true", "yes", "on"].includes(envValue.trim().toLowerCase());
}

function debugLog(message: string) {
  if (boolSetting(undefined, "LOCAL_AUDIO_FEATURE_DEBUG", false)) console.log(message);
}

function installShutdownHandlers() {
  if (localAudioFeatureGlobals.mixarrLocalAudioFeatureSignalHandlersInstalled) return;
  localAudioFeatureGlobals.mixarrLocalAudioFeatureSignalHandlersInstalled = true;

  const requestShutdown = () => {
    localAudioFeatureGlobals.mixarrLocalAudioFeatureShutdownRequested = true;
  };
  process.once("SIGTERM", requestShutdown);
  process.once("SIGINT", requestShutdown);
}

function shutdownRequested() {
  return localAudioFeatureGlobals.mixarrLocalAudioFeatureShutdownRequested === true;
}

export function normalizeAudioFeatureAnalysisScope(value: unknown): LocalAudioFeatureAnalysisScope {
  const normalized = String(value || "windows").trim().toLowerCase();
  return normalized === "whole_track" ? "whole_track" : "windows";
}

function resolveAudioFeatureAnalysisScope(userValue?: string | null): LocalAudioFeatureAnalysisScope {
  return normalizeAudioFeatureAnalysisScope(userValue ?? process.env.LOCAL_AUDIO_FEATURES_SCOPE);
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function validNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validBpm(value: unknown) {
  const bpm = Number(value);
  return Number.isFinite(bpm) && bpm >= 40 && bpm <= 260 ? bpm : null;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function weightedAverage(values: Array<{ value: number; weight: number }>) {
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return values.length ? average(values.map((item) => item.value)) : null;
  return values.reduce((sum, item) => sum + (item.value * item.weight), 0) / totalWeight;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function mode(values: Array<string | null>) {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

const ESSENTIA_FEATURE_SCRIPT = String.raw`
import json
import math
import sys
import warnings

warnings.filterwarnings("ignore")

import numpy as np
import essentia.standard as es

def clamp01(value):
    if value is None or not math.isfinite(float(value)):
        return 0.0
    return max(0.0, min(1.0, float(value)))

def safe_float(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except Exception:
        return None

audio = es.MonoLoader(filename=sys.argv[1], sampleRate=44100)()
duration = max(len(audio) / 44100.0, 0.001)
audio_np = np.asarray(audio, dtype=np.float32)

rms = float(np.sqrt(np.mean(np.square(audio_np)))) if len(audio_np) else 0.0
loudness_db = 20.0 * math.log10(max(rms, 1e-8))
replay_gain = -14.0 - loudness_db
zcr = float(np.mean(np.abs(np.diff(np.signbit(audio_np))))) if len(audio_np) > 1 else 0.0

frame_size = 2048
hop_size = 1024
centroids = []
flatnesses = []
contrasts = []
fluxes = []
energies = []
prev_norm = None
window = np.hanning(frame_size)
freqs = np.fft.rfftfreq(frame_size, 1.0 / 44100.0)

for start in range(0, max(0, len(audio_np) - frame_size), hop_size):
    frame = audio_np[start:start + frame_size] * window
    spectrum = np.abs(np.fft.rfft(frame)) + 1e-12
    total = float(np.sum(spectrum))
    if total <= 0:
        continue
    centroids.append(float(np.sum(freqs * spectrum) / total))
    flatnesses.append(float(np.exp(np.mean(np.log(spectrum))) / np.mean(spectrum)))
    sorted_spectrum = np.sort(spectrum)
    low = float(np.mean(sorted_spectrum[:max(1, len(sorted_spectrum) // 10)]))
    high = float(np.mean(sorted_spectrum[-max(1, len(sorted_spectrum) // 10):]))
    contrasts.append(float(20.0 * math.log10((high + 1e-12) / (low + 1e-12))))
    energy = float(np.sqrt(np.mean(np.square(frame))))
    energies.append(energy)
    norm = spectrum / total
    if prev_norm is not None:
        fluxes.append(float(np.sqrt(np.sum(np.square(norm - prev_norm)))))
    prev_norm = norm

spectral_centroid = float(np.mean(centroids)) if centroids else None
spectral_flatness = float(np.mean(flatnesses)) if flatnesses else None
spectral_contrast = float(np.mean(contrasts)) if contrasts else None
energy_std = float(np.std(energies)) if energies else 0.0
energy_mean = float(np.mean(energies)) if energies else 0.0
dynamic_complexity = None

try:
    dyn = es.DynamicComplexity()(audio)
    if isinstance(dyn, tuple):
        dynamic_complexity = safe_float(dyn[0])
    else:
        dynamic_complexity = safe_float(dyn)
except Exception:
    dynamic_complexity = energy_std / max(energy_mean, 1e-6)

tempo = None
tempo_confidence = 0.0
beats = []
try:
    bpm, ticks, confidence, estimates, bpm_intervals = es.RhythmExtractor2013(method="multifeature")(audio)
    bpm = safe_float(bpm)
    if bpm and 40 <= bpm <= 260:
        tempo = bpm
        tempo_confidence = clamp01(confidence)
        beats = list(ticks)
except Exception:
    pass

rhythm_stability = 0.0
if len(beats) >= 4:
    intervals = np.diff(np.asarray(beats, dtype=np.float32))
    median_interval = float(np.median(intervals))
    if median_interval > 0:
        rhythm_stability = clamp01(1.0 - (float(np.std(intervals)) / median_interval))

onset_rate = 0.0
if len(energies) >= 3:
    envelope = np.asarray(energies, dtype=np.float32)
    diff = np.diff(envelope)
    threshold = float(np.mean(diff) + np.std(diff))
    onset_count = int(np.sum(diff > threshold))
    onset_rate = onset_count / duration

key = None
scale = None
key_strength = None
try:
    key, scale, key_strength = es.KeyExtractor()(audio)
    key_strength = safe_float(key_strength)
except Exception:
    pass

rms_norm = clamp01((loudness_db + 45.0) / 33.0)
centroid_norm = clamp01((spectral_centroid or 0.0) / 4500.0)
contrast_norm = clamp01((spectral_contrast or 0.0) / 55.0)
flatness_norm = clamp01(spectral_flatness or 0.0)
dynamic_norm = clamp01((dynamic_complexity or 0.0) / 8.0)
onset_norm = clamp01(onset_rate / 5.0)
bpm_norm = 0.0
if tempo:
    bpm_norm = clamp01(1.0 - abs(float(tempo) - 120.0) / 90.0)

energy = clamp01(0.42 * rms_norm + 0.18 * onset_norm + 0.16 * centroid_norm + 0.12 * bpm_norm + 0.12 * (1.0 - dynamic_norm))
danceability = clamp01(0.45 * tempo_confidence + 0.25 * rhythm_stability + 0.18 * bpm_norm + 0.12 * (1.0 - dynamic_norm))
acousticness = clamp01(0.34 * (1.0 - centroid_norm) + 0.23 * (1.0 - flatness_norm) + 0.18 * dynamic_norm + 0.15 * (1.0 - rms_norm) + 0.10 * (1.0 - min(1.0, zcr * 20.0)))

major = 1.0 if str(scale).lower() == "major" else 0.0
minor = 1.0 if str(scale).lower() == "minor" else 0.0
valence = clamp01(0.34 * energy + 0.24 * centroid_norm + 0.22 * major + 0.12 * acousticness - 0.20 * minor + 0.28)

confidence = clamp01(0.28 + 0.25 * tempo_confidence + 0.16 * rhythm_stability + 0.16 * min(1.0, duration / 45.0) + 0.15 * (1.0 - min(1.0, dynamic_norm)))

print(json.dumps({
    "energy": energy,
    "valence": valence,
    "danceability": danceability,
    "acousticness": acousticness,
    "tempo": tempo,
    "tempoConfidence": tempo_confidence,
    "loudness": loudness_db,
    "dynamicComplexity": dynamic_complexity,
    "key": key,
    "scale": scale,
    "keyStrength": key_strength,
    "spectralCentroid": spectral_centroid,
    "spectralContrast": spectral_contrast,
    "rhythmStability": rhythm_stability,
    "onsetRate": onset_rate,
    "zeroCrossingRate": zcr,
    "replayGain": replay_gain,
    "confidence": confidence,
}))
`;

async function createTempDir() {
  await mkdir(featureTempRoot, { recursive: true });
  return mkdtemp(path.join(featureTempRoot, "sample-"));
}

async function analyzeSampleWithEssentia(wavPath: string, timeoutMs = 180000): Promise<LocalAudioFeatureWindowResult | null> {
  const result = await runCommand(essentiaPythonPath, ["-c", ESSENTIA_FEATURE_SCRIPT, wavPath], timeoutMs);
  const outputLines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  const jsonLine = outputLines[outputLines.length - 1];
  if (!jsonLine) return null;

  const payload = JSON.parse(jsonLine);
  return {
    energy: clamp01(Number(payload.energy)),
    valence: clamp01(Number(payload.valence)),
    danceability: clamp01(Number(payload.danceability)),
    acousticness: clamp01(Number(payload.acousticness)),
    tempo: validBpm(payload.tempo),
    tempoConfidence: clamp01(Number(payload.tempoConfidence)),
    loudness: validNumber(payload.loudness),
    dynamicComplexity: validNumber(payload.dynamicComplexity),
    key: typeof payload.key === "string" && payload.key ? payload.key : null,
    scale: typeof payload.scale === "string" && payload.scale ? payload.scale : null,
    keyStrength: validNumber(payload.keyStrength),
    spectralCentroid: validNumber(payload.spectralCentroid),
    spectralContrast: validNumber(payload.spectralContrast),
    rhythmStability: clamp01(Number(payload.rhythmStability)),
    onsetRate: validNumber(payload.onsetRate),
    zeroCrossingRate: validNumber(payload.zeroCrossingRate),
    replayGain: validNumber(payload.replayGain),
    confidence: clamp01(Number(payload.confidence)),
  };
}

function combineResults(
  results: LocalAudioFeatureWindowResult[],
  sourceTypes: string[],
  analysisScope: LocalAudioFeatureAnalysisScope,
  expectedWindowCount = results.length,
): LocalAudioFeatureResult | null {
  if (!results.length) return null;
  const numeric = (selector: (result: LocalAudioFeatureWindowResult) => number | null) =>
    weightedAverage(results
      .map((result) => ({ value: selector(result), weight: Math.max(0.05, result.confidence) }))
      .filter((item): item is { value: number; weight: number } => item.value !== null));
  const normalized = (selector: (result: LocalAudioFeatureWindowResult) => number) =>
    clamp01(weightedAverage(results.map((result) => ({
      value: selector(result),
      weight: Math.max(0.05, result.confidence),
    }))) ?? 0);
  const tempos = results
    .map((result) => ({ value: result.tempo, weight: Math.max(0.05, result.tempoConfidence || result.confidence) }))
    .filter((item): item is { value: number; weight: number } => item.value !== null);
  const tempo = tempos.length ? Number((weightedAverage(tempos) ?? median(tempos.map((item) => item.value))).toFixed(2)) : null;
  const coveragePenalty = Math.max(0, expectedWindowCount - results.length) * 0.04;
  const agreementBoost = analysisScope === "windows" ? Math.min(0.12, (results.length - 1) * 0.04) : 0;
  const confidence = clamp01((weightedAverage(results.map((result) => ({
    value: result.confidence,
    weight: Math.max(0.05, result.confidence),
  }))) ?? 0.4) + agreementBoost - coveragePenalty);

  return {
    energy: normalized((result) => result.energy),
    valence: normalized((result) => result.valence),
    danceability: normalized((result) => result.danceability),
    acousticness: normalized((result) => result.acousticness),
    tempo,
    tempoConfidence: normalized((result) => result.tempoConfidence),
    loudness: numeric((result) => result.loudness),
    dynamicComplexity: numeric((result) => result.dynamicComplexity),
    key: mode(results.map((result) => result.key)),
    scale: mode(results.map((result) => result.scale)),
    keyStrength: numeric((result) => result.keyStrength),
    spectralCentroid: numeric((result) => result.spectralCentroid),
    spectralContrast: numeric((result) => result.spectralContrast),
    rhythmStability: normalized((result) => result.rhythmStability ?? 0),
    onsetRate: numeric((result) => result.onsetRate),
    zeroCrossingRate: numeric((result) => result.zeroCrossingRate),
    replayGain: numeric((result) => result.replayGain),
    confidence,
    windowCount: results.length,
    sourceTypes: Array.from(new Set(sourceTypes)),
    analysisScope,
  };
}

function trackLabel(track: any) {
  return `${track.artist.title} - ${track.title}`;
}

function redactedMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return redactSensitiveUrl(message);
}

function audioFeatureShortTrackReason(durationSeconds: number, minimumDurationSeconds = minimumAudioFeatureDurationSeconds) {
  return `Track duration ${durationSeconds.toFixed(2)}s is below minimum ${formatSeconds(minimumDurationSeconds)}s for local audio feature analysis`;
}

function shortTrackError(durationSeconds: number, sourceType?: string) {
  return new ShortTrackAudioFeatureError(
    audioFeatureShortTrackReason(durationSeconds),
    durationSeconds,
    minimumAudioFeatureDurationSeconds,
    sourceType,
  );
}

function validateMinimumAudioFeatureDuration(durationSeconds: number, sourceType?: string, allowConfiguredShortWholeTrack = false) {
  if (
    durationSeconds < minimumAudioFeatureDurationSeconds
    && !(allowConfiguredShortWholeTrack && allowShortWholeTrackAnalysis && durationSeconds >= 5)
  ) {
    throw shortTrackError(durationSeconds, sourceType);
  }
}

function wholeTrackValidationMinimumSeconds() {
  return allowShortWholeTrackAnalysis
    ? Math.min(minimumAudioFeatureDurationSeconds, 5)
    : minimumAudioFeatureDurationSeconds;
}

function fullTrackTimeoutMs(track: any) {
  const durationSeconds = track.duration ? Number(track.duration) / 1000 : 0;
  const configuredTimeoutMs = localAudioFeatureAnalysisTimeoutSeconds * 1000;
  return Math.max(configuredTimeoutMs, Math.ceil(Math.max(durationSeconds, 60) * 2500));
}

function resultFromWholeTrack(
  analysis: LocalAudioFeatureWindowResult | null,
  sourceTypes: string[],
): LocalAudioFeatureResult | null {
  return analysis ? combineResults([analysis], sourceTypes, "whole_track", 1) : null;
}

async function analyzeWholeTrackSource(
  track: any,
  source: AudioInputSource,
  tempDir: string,
  index: number,
): Promise<LocalAudioFeatureResult | null> {
  const timeoutMs = fullTrackTimeoutMs(track);
  const sourceTypes = [source.type];

  if (source.type === "local-file") {
    const validation = await validateAudioSample(source.input, undefined, {
      minimumDurationSeconds: wholeTrackValidationMinimumSeconds(),
    });
    if (validation.failureCode === "too_short" && validation.duration !== undefined) {
      throw shortTrackError(validation.duration, source.type);
    }
    if (validation.ok) {
      if (validation.duration !== undefined) {
        validateMinimumAudioFeatureDuration(validation.duration, source.type, true);
      }
      try {
        const direct = await analyzeSampleWithEssentia(source.input, timeoutMs);
        const directResult = resultFromWholeTrack(direct, sourceTypes);
        if (directResult) return directResult;
      } catch (error) {
        console.warn(
          `[LocalAudioFeatureEngine] Essentia could not read original local file for "${trackLabel(track)}"; decoding full track to WAV: ${redactedMessage(error)}`,
        );
      }
    } else {
      console.warn(
        `[LocalAudioFeatureEngine] Local file did not validate before whole-track analysis for "${trackLabel(track)}"; decoding full track to WAV: ${validation.reason || "unknown validation failure"}`,
      );
    }
  }

  const wavPath = path.join(tempDir, `whole-track-${index}.wav`);
  let validation;
  try {
    validation = await decodeAudioSourceToWav(source, wavPath, timeoutMs, {
      minimumDurationSeconds: wholeTrackValidationMinimumSeconds(),
    });
  } catch (error) {
    throw new ExtractionFailedAudioFeatureError(
      `ffmpeg could not decode whole-track WAV from ${source.type}: ${redactedMessage(error)}`,
    );
  }
  if (validation.failureCode === "too_short" && validation.duration !== undefined) {
    throw shortTrackError(validation.duration, source.type);
  }
  if (!validation.ok) {
    throw new ExtractionFailedAudioFeatureError(
      `Decoded whole-track WAV did not validate from ${source.type}: ${validation.reason || "unknown validation failure"}`,
    );
  }
  if (validation.duration !== undefined) {
    validateMinimumAudioFeatureDuration(validation.duration, source.type, true);
  }

  const decoded = await analyzeSampleWithEssentia(wavPath, timeoutMs);
  return resultFromWholeTrack(decoded, sourceTypes);
}

async function analyzeTrackWholeTrack(track: any, tempDir: string): Promise<LocalAudioFeatureResult | null> {
  const sources = await buildAudioInputSourcesForTrack(track, 0);
  const extractionErrors: string[] = [];
  const analyzerErrors: string[] = [];
  let validatedSourceCount = 0;

  for (let index = 0; index < sources.length; index++) {
    const source = sources[index];
    debugLog(`[LocalAudioFeatureEngine] Analyzing ${trackLabel(track)} using ${source.type} whole_track.`);

    try {
      const result = await analyzeWholeTrackSource(track, source, tempDir, index);
      validatedSourceCount += 1;
      if (result) return result;
    } catch (error) {
      if (error instanceof ShortTrackAudioFeatureError) {
        console.warn(
          `[LocalAudioFeatureEngine] Short track skipped: ${trackLabel(track)} duration=${error.durationSeconds.toFixed(2)}s minimum=${formatSeconds(error.minimumDurationSeconds)}s source=${error.sourceType || source.type}`,
        );
        throw error;
      }
      const message = redactedMessage(error);
      if (error instanceof ExtractionFailedAudioFeatureError) {
        extractionErrors.push(`${source.type}: ${message}`);
        console.warn(`[LocalAudioFeatureEngine] Whole-track extraction failed using ${source.type} for "${trackLabel(track)}": ${message}`);
      } else {
        validatedSourceCount += 1;
        analyzerErrors.push(`${source.type}: ${message}`);
        console.warn(`[LocalAudioFeatureEngine] Essentia whole-track analysis failed using ${source.type} for "${trackLabel(track)}": ${message}`);
      }
    }
  }

  if (validatedSourceCount === 0 && extractionErrors.length > 0) {
    throw new ExtractionFailedAudioFeatureError(
      `No whole-track audio source could be validated for "${trackLabel(track)}". ${extractionErrors.join(" | ")}`,
    );
  }

  if (analyzerErrors.length > 0) {
    throw new AnalyzerFailedAudioFeatureError(
      `Essentia failed for every validated whole-track source from "${trackLabel(track)}". ${analyzerErrors.join(" | ")}`,
    );
  }

  return null;
}

async function analyzeTrackWindows(track: any, tempDir: string): Promise<LocalAudioFeatureResult | null> {
  const trackDurationSeconds = track.duration ? Number(track.duration) / 1000 : null;
  if (trackDurationSeconds !== null) {
    validateMinimumAudioFeatureDuration(trackDurationSeconds);
  }

  const windows = buildBpmSampleWindows(track.duration);
  const results: LocalAudioFeatureWindowResult[] = [];
  const sourceTypes: string[] = [];
  const extractionErrors: string[] = [];
  const analyzerErrors: string[] = [];

  for (let index = 0; index < windows.length; index++) {
    const sampleWindow = windows[index];
    const wavPath = path.join(tempDir, `feature-sample-${index}.wav`);
    let sourceType: string;
    try {
      sourceType = await extractAudioSampleFromSources(
        track,
        wavPath,
        sampleWindow.startSeconds,
        sampleWindow.durationSeconds,
        sampleWindow.label,
      );
      sourceTypes.push(sourceType);
    } catch (error) {
      if (isShortTrackBpmError(error)) {
        const durationSeconds = (error as ShortTrackBpmError).durationSeconds;
        if (durationSeconds !== undefined) throw shortTrackError(durationSeconds);
        throw error;
      }
      const message = redactedMessage(error);
      extractionErrors.push(`${sampleWindow.label}: ${message}`);
      console.warn(`[LocalAudioFeatureEngine] Skipping ${sampleWindow.label} sample for "${trackLabel(track)}": ${message}`);
      continue;
    }

    try {
      debugLog(`[LocalAudioFeatureEngine] Analyzing ${trackLabel(track)} using ${sourceType} windows.`);
      const analysis = await analyzeSampleWithEssentia(wavPath);
      if (analysis) {
        results.push(analysis);
        debugLog(
          `[LocalAudioFeatureEngine] Window ${sampleWindow.label} -> energy=${analysis.energy.toFixed(2)} mood=${analysis.valence.toFixed(2)} danceability=${analysis.danceability.toFixed(2)} confidence=${analysis.confidence.toFixed(2)}`,
        );
      }
    } catch (error) {
      const message = redactedMessage(error);
      analyzerErrors.push(`${sampleWindow.label}: ${message}`);
      console.warn(`[LocalAudioFeatureEngine] Essentia failed for "${trackLabel(track)}" (${sampleWindow.label}): ${message}`);
    }
  }

  const combined = combineResults(results, sourceTypes, "windows", windows.length);
  if (combined) return combined;

  if (sourceTypes.length === 0) {
    throw new ExtractionFailedAudioFeatureError(
      `No audio feature sample windows could be extracted for "${trackLabel(track)}". ${extractionErrors.join(" | ")}`,
    );
  }

  if (analyzerErrors.length > 0) {
    throw new AnalyzerFailedAudioFeatureError(
      `Essentia failed for every validated audio feature sample from "${trackLabel(track)}". ${analyzerErrors.join(" | ")}`,
    );
  }

  return null;
}

async function analyzeTrackLocally(track: any, scope: LocalAudioFeatureAnalysisScope): Promise<LocalAudioFeatureResult | null> {
  const tempDir = await createTempDir();

  try {
    // We must await here so that the finally cleanup runs after the analysis
    // finishes writing its WAV samples. A bare `return promise` would let the
    // finally delete the temp dir first, and the still-running extraction would
    // re-create and fill it with nothing left to clean it up afterward.
    if (scope === "whole_track") {
      return await analyzeTrackWholeTrack(track, tempDir);
    }

    return await analyzeTrackWindows(track, tempDir);
  } finally {
    const removedBytes = await directorySize(tempDir).catch(() => 0);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    console.log(`[LocalAudioFeatureEngine] Temp cleanup for track ${trackLabel(track)} removed ${formatBytes(removedBytes)}.`);
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

function isApiOwnedSource(source: unknown, audioFeatureSource: unknown) {
  if (audioFeatureSource === "api") return true;
  if (typeof source !== "string") return false;
  const normalized = source.toLowerCase();
  return Boolean(source) && !normalized.startsWith("local") && normalized !== "not_found" && normalized !== "estimated";
}

function shouldKeepExistingField(existing: any, field: string, sourceField: string, preferApi: boolean, force: boolean) {
  if (force) return false;
  if (existing?.[field] === null || existing?.[field] === undefined) return false;
  if (!preferApi) return false;
  return existing?.[sourceField] === "api" || isApiOwnedSource(existing?.source, existing?.audioFeatureSource);
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function resolveEffectiveLocalAudioFeatureData(existing: any, options: {
  preferLocal: boolean;
  allowEstimated: boolean;
}) {
  const localMood = existing?.localMood ?? null;
  const localDanceability = existing?.localDanceability ?? null;
  const localAcousticness = existing?.localAcousticness ?? null;

  return options.preferLocal
    ? {
      energy: firstNumber(existing?.localEnergy, existing?.apiEnergy),
      valence: firstNumber(localMood, existing?.apiMood),
      danceability: firstNumber(localDanceability, existing?.apiDanceability),
      acousticness: firstNumber(localAcousticness, existing?.apiAcousticness),
      loudness: firstNumber(existing?.localLoudness, existing?.apiLoudness),
    }
    : {
      energy: firstNumber(existing?.apiEnergy, existing?.localEnergy),
      valence: firstNumber(existing?.apiMood, localMood),
      danceability: firstNumber(existing?.apiDanceability, localDanceability),
      acousticness: firstNumber(existing?.apiAcousticness, localAcousticness),
      loudness: firstNumber(existing?.apiLoudness, existing?.localLoudness),
  };
}

function audioFeatureStatusFor(data: Record<string, unknown>, options: {
  preferLocal: boolean;
  allowEstimated: boolean;
}): AudioFeatureStatus {
  const effective = getEffectiveAudioFeatures({ audioFeature: data }, {
    preferLocalAudioFeatures: options.preferLocal,
    allowEstimated: options.allowEstimated,
  });
  if (effective.complete) return "success";
  if ([effective.energy, effective.mood, effective.danceability, effective.acousticness, effective.tempo].some((value) => value !== null)) {
    return "partial";
  }
  return "no_data";
}

function sourceForEffectiveField(effectiveValue: number | null, apiValue: unknown, localValue: unknown) {
  if (effectiveValue === null) return null;
  if (apiValue !== null && apiValue !== undefined && apiValue !== "") {
    const apiNumber = Number(apiValue);
    if (Number.isFinite(apiNumber) && apiNumber === effectiveValue) return "api";
  }
  if (localValue !== null && localValue !== undefined && localValue !== "") {
    const localNumber = Number(localValue);
    if (Number.isFinite(localNumber) && localNumber === effectiveValue) return "local_essentia";
  }
  return null;
}

function savedFeatureSelect() {
  return {
    id: true,
    title: true,
    artist: { select: { title: true } },
    audioFeature: true,
  } as const;
}

async function logPostSaveVerification(trackId: string, settings: {
  preferLocal: boolean;
  allowEstimated: boolean;
}) {
  const saved = await prisma.track.findUnique({
    where: { id: trackId },
    select: savedFeatureSelect(),
  });
  if (!saved?.audioFeature) return;
  const feature = saved.audioFeature;
  const effective = getEffectiveAudioFeatures(saved, {
    preferLocalAudioFeatures: settings.preferLocal,
    allowEstimated: settings.allowEstimated,
  });
  const selectedForPartialRetry = effective.partial;
  console.log("[LocalAudioFeatureEngine] Saved local audio features:", {
    id: saved.id,
    title: `${saved.artist.title} - ${saved.title}`,
    audioFeatureStatus: feature.audioFeatureStatus,
    audioFeatureSource: feature.audioFeatureSource,
    audioFeatureAnalysisScope: feature.audioFeatureAnalysisScope,
    energy: feature.energy,
    mood: feature.valence,
    danceability: feature.danceability,
    acousticness: feature.acousticness,
    tempo: feature.tempo,
    localEnergy: feature.localEnergy,
    localMood: feature.localMood,
    localDanceability: feature.localDanceability,
    localAcousticness: feature.localAcousticness,
    effectiveEnergy: effective.energy,
    effectiveMood: effective.mood,
    effectiveDanceability: effective.danceability,
    effectiveAcousticness: effective.acousticness,
    effectiveTempo: effective.tempo,
  });
  console.log("[LocalAudioFeatureEngine] Completion check after save:", {
    complete: effective.complete,
    partial: effective.partial,
    missingFields: effective.missingFields,
    selectedForPartialRetry,
  });
}

async function saveLocalFeatures(track: any, result: LocalAudioFeatureResult, options: {
  preferLocal: boolean;
  force: boolean;
  allowEstimatedMoodAcousticness: boolean;
}) {
  const existing = track.audioFeature || {};
  const analyzedAt = new Date();
  const update: Record<string, unknown> = {
    loudness: result.loudness,
    dynamicComplexity: result.dynamicComplexity,
    key: result.key,
    scale: result.scale,
    spectralCentroid: result.spectralCentroid,
    spectralContrast: result.spectralContrast,
    rhythmStability: result.rhythmStability,
    onsetRate: result.onsetRate,
    zeroCrossingRate: result.zeroCrossingRate,
    replayGain: result.replayGain,
    audioFeatureConfidence: result.confidence,
    audioFeatureAnalyzedAt: analyzedAt,
    audioFeatureFailureReason: null,
    audioFeatureAnalysisScope: result.analysisScope,
    lastUpdated: analyzedAt,
  };
  update.localEnergy = result.energy;
  update.localLoudness = result.loudness;
  update.localMood = result.valence;
  update.localDanceability = result.danceability;
  update.localAcousticness = result.acousticness;

  const setField = (field: string, sourceField: string, value: number | null, source: string) => {
    if (value === null || shouldKeepExistingField(existing, field, sourceField, !options.preferLocal, options.force)) {
      update[field] = existing[field] ?? null;
      update[sourceField] = existing[sourceField] ?? null;
      return;
    }
    update[field] = value;
    update[sourceField] = source;
  };

  setField("energy", "energySource", result.energy, "local_essentia");
  setField("valence", "valenceSource", result.valence, "local_essentia");
  setField("danceability", "danceabilitySource", result.danceability, "local_essentia");
  setField("acousticness", "acousticnessSource", result.acousticness, "local_essentia");
  if (result.tempo !== null && !shouldKeepExistingField(existing, "tempo", "tempoSource", !options.preferLocal, options.force)) {
    update.tempo = result.tempo;
    update.tempoSource = "Essentia local audio feature analysis";
    update.tempoConfidence = result.tempoConfidence;
  } else {
    update.tempo = existing.tempo ?? null;
    update.tempoSource = existing.tempoSource ?? null;
    update.tempoConfidence = existing.tempoConfidence ?? null;
  }

  const effective = resolveEffectiveLocalAudioFeatureData({ ...existing, ...update }, {
    preferLocal: options.preferLocal,
    allowEstimated: options.allowEstimatedMoodAcousticness,
  });
  update.energy = effective.energy;
  update.valence = effective.valence;
  update.danceability = effective.danceability;
  update.acousticness = effective.acousticness;
  update.loudness = effective.loudness;
  update.energySource = sourceForEffectiveField(effective.energy, existing.apiEnergy, update.localEnergy) ?? update.energySource;
  update.valenceSource = sourceForEffectiveField(effective.valence, existing.apiMood, update.localMood) ?? update.valenceSource;
  update.danceabilitySource = sourceForEffectiveField(effective.danceability, existing.apiDanceability, update.localDanceability) ?? update.danceabilitySource;
  update.acousticnessSource = sourceForEffectiveField(effective.acousticness, existing.apiAcousticness, update.localAcousticness) ?? update.acousticnessSource;
  update.effectiveEnergy = effective.energy;
  update.effectiveMood = effective.valence;
  update.effectiveDanceability = effective.danceability;
  update.effectiveAcousticness = effective.acousticness;
  update.audioFeatureSource = isApiOwnedSource(existing.source, existing.audioFeatureSource)
    && !options.preferLocal
    && Object.values(update).some((value) => value !== null && value !== undefined)
    ? "mixed"
    : "local_essentia";
  update.source = existing.source && isApiOwnedSource(existing.source, existing.audioFeatureSource)
    ? existing.source
    : "Essentia local audio analysis";
  update.confidence = Math.max(Number(existing.confidence) || 0, result.confidence);
  update.audioFeatureStatus = audioFeatureStatusFor(update, {
    preferLocal: options.preferLocal,
    allowEstimated: options.allowEstimatedMoodAcousticness,
  });

  await prisma.audioFeature.upsert({
    where: { trackId: track.id },
    update,
    create: {
      trackId: track.id,
      ...update,
    } as any,
  });

  debugLog(
    `[LocalAudioFeatureEngine] ${trackLabel(track)} -> energy=${result.energy.toFixed(2)} mood=${result.valence.toFixed(2)} danceability=${result.danceability.toFixed(2)} acousticness=${result.acousticness.toFixed(2)} bpm=${result.tempo?.toFixed(1) || "n/a"} source=local_essentia scope=${result.analysisScope} confidence=${result.confidence.toFixed(2)}`,
  );
  debugLog(`[LocalAudioFeatureEngine] Persisted local audio features for track ${track.id}.`);
  await logPostSaveVerification(track.id, {
    preferLocal: options.preferLocal,
    allowEstimated: options.allowEstimatedMoodAcousticness,
  });
}

async function saveFailure(trackId: string, status: AudioFeatureStatus, scope: LocalAudioFeatureAnalysisScope, reason?: string) {
  const analyzedAt = new Date();
  await prisma.audioFeature.upsert({
    where: { trackId },
    update: {
      audioFeatureStatus: status,
      audioFeatureSource: status === "no_data" ? "local_heuristic" : "local_essentia",
      audioFeatureConfidence: 0,
      audioFeatureAnalyzedAt: analyzedAt,
      audioFeatureFailureReason: reason || null,
      audioFeatureAnalysisScope: scope,
      lastUpdated: analyzedAt,
    },
    create: {
      trackId,
      audioFeatureStatus: status,
      audioFeatureSource: status === "no_data" ? "local_heuristic" : "local_essentia",
      audioFeatureConfidence: 0,
      audioFeatureAnalyzedAt: analyzedAt,
      audioFeatureFailureReason: reason || null,
      audioFeatureAnalysisScope: scope,
      lastUpdated: analyzedAt,
    },
  });
}

function terminalLocalAttemptedAudioFeatureWhere() {
  return {
    audioFeatureAnalyzedAt: { not: null },
    audioFeatureStatus: { in: ["no_data", "extraction_failed", "analyzer_failed", "too_short"] },
    OR: [
      { audioFeatureSource: { in: ["local_essentia", "local_heuristic", "mixed"] } },
      { energySource: "local_essentia" },
      { valenceSource: { in: ["local_essentia", "local_heuristic"] } },
      { danceabilitySource: { in: ["local_essentia", "local_heuristic"] } },
      { acousticnessSource: { in: ["local_essentia", "local_heuristic"] } },
    ],
  };
}

function localAudioFeatureReprocessWhere() {
  return {
    audioFeature: {
      is: {
        OR: [
          { audioFeatureSource: { in: ["local_essentia", "local_heuristic", "mixed"] } },
          { energySource: "local_essentia" },
          { valenceSource: { in: ["local_essentia", "local_heuristic"] } },
          { danceabilitySource: { in: ["local_essentia", "local_heuristic"] } },
          { acousticnessSource: { in: ["local_essentia", "local_heuristic"] } },
        ],
      },
    },
  };
}

function apiAudioFeatureReprocessWhere() {
  return {
    audioFeature: {
      is: {
        OR: [
          { audioFeatureSource: "api" },
          { energySource: "api" },
          { valenceSource: "api" },
          { danceabilitySource: "api" },
          { acousticnessSource: "api" },
          { apiEnergy: { not: null } },
          { apiMood: { not: null } },
          { apiDanceability: { not: null } },
          { apiAcousticness: { not: null } },
        ],
      },
    },
  };
}

export function localAudioFeatureWhere(reprocessLocal: boolean, reprocessApiWithLocal = false, analysisScope?: string | null) {
  if (reprocessLocal) {
    return {
      AND: [
        { syncStatus: "active" },
        {
          OR: [
            missingAudioFeatureTrackWhere(),
            localAudioFeatureReprocessWhere(),
            ...(reprocessApiWithLocal ? [apiAudioFeatureReprocessWhere()] : []),
          ],
        },
      ],
    };
  }

  return {
    AND: [
      { syncStatus: "active" },
      {
        OR: [
          {
            AND: [
              missingAudioFeatureTrackWhere(),
              { NOT: { audioFeature: { is: terminalLocalAttemptedAudioFeatureWhere() } } },
            ],
          },
          ...(reprocessApiWithLocal ? [{
            AND: [
              apiAudioFeatureReprocessWhere(),
              { NOT: localEssentiaAudioFeatureSuccessTrackWhere(analysisScope) },
            ],
          }] : []),
        ],
      },
    ],
  };
}

type LocalBackfillTrack = {
  syncStatus?: string | null;
  audioFeature?: {
    energy?: number | null;
    valence?: number | null;
    danceability?: number | null;
    acousticness?: number | null;
    tempo?: number | null;
    source?: string | null;
    audioFeatureSource?: string | null;
    audioFeatureStatus?: string | null;
    audioFeatureConfidence?: number | null;
    audioFeatureAnalyzedAt?: Date | string | null;
    energySource?: string | null;
    valenceSource?: string | null;
    danceabilitySource?: string | null;
    acousticnessSource?: string | null;
    apiEnergy?: number | null;
    apiMood?: number | null;
    apiDanceability?: number | null;
    apiAcousticness?: number | null;
    localEnergy?: number | null;
    localMood?: number | null;
    localDanceability?: number | null;
    localAcousticness?: number | null;
    effectiveEnergy?: number | null;
    effectiveMood?: number | null;
    effectiveDanceability?: number | null;
    effectiveAcousticness?: number | null;
    audioFeatureAnalysisScope?: string | null;
  } | null;
};

function hasTerminalLocalAudioFeatureAttempt(track: LocalBackfillTrack) {
  const feature = track.audioFeature;
  if (!feature?.audioFeatureAnalyzedAt) return false;
  if (!["no_data", "extraction_failed", "analyzer_failed", "too_short"].includes(String(feature.audioFeatureStatus || ""))) {
    return false;
  }
  if (["local_essentia", "local_heuristic", "mixed"].includes(String(feature.audioFeatureSource || ""))) return true;
  return [
    feature.energySource,
    feature.valenceSource,
    feature.danceabilitySource,
    feature.acousticnessSource,
  ].some((source) => source === "local_essentia" || source === "local_heuristic");
}

function hasApiAudioFeatureAttempt(track: LocalBackfillTrack) {
  const feature = track.audioFeature;
  if (!feature) return false;
  if (feature.audioFeatureSource === "api") return true;
  return [
    feature.energySource,
    feature.valenceSource,
    feature.danceabilitySource,
    feature.acousticnessSource,
  ].some((source) => source === "api")
    || [feature.apiEnergy, feature.apiMood, feature.apiDanceability, feature.apiAcousticness]
      .some((value) => value !== null && value !== undefined);
}

function hasCompleteLocalEssentiaAudioFeatures(track: LocalBackfillTrack, effectiveComplete: boolean, analysisScope?: string | null) {
  const feature = track.audioFeature;
  if (!feature || feature.audioFeatureStatus !== "success" || !effectiveComplete) return false;
  if (analysisScope && feature.audioFeatureAnalysisScope !== analysisScope) return false;
  return feature.audioFeatureSource === "local_essentia"
    || feature.audioFeatureSource === "mixed"
    || [
      feature.energySource,
      feature.valenceSource,
      feature.danceabilitySource,
      feature.acousticnessSource,
    ].some((source) => source === "local_essentia")
    || [feature.localEnergy, feature.localMood, feature.localDanceability, feature.localAcousticness]
      .some((value) => value !== null && value !== undefined);
}

export function needsLocalAudioFeatureBackfill(track: LocalBackfillTrack, options: {
  reprocessLocal?: boolean;
  reprocessApiWithLocal?: boolean;
  preferLocal?: boolean;
  allowEstimated?: boolean;
  analysisScope?: string | null;
} = {}) {
  if (track.syncStatus && track.syncStatus !== "active") return false;
  if (!track.audioFeature) return true;
  const effective = getEffectiveAudioFeatures(track, {
    preferLocalAudioFeatures: options.preferLocal ?? true,
    allowEstimated: options.allowEstimated ?? true,
  });
  const localSuccess = hasCompleteLocalEssentiaAudioFeatures(track, effective.complete, options.analysisScope);
  if (!options.reprocessLocal && localSuccess) return false;
  const hasTerminalLocalAttempt = hasTerminalLocalAudioFeatureAttempt(track);
  if (!options.reprocessLocal && hasTerminalLocalAttempt) return false;
  if (options.reprocessApiWithLocal && hasApiAudioFeatureAttempt(track) && !localSuccess) return true;
  return options.reprocessLocal ? hasTerminalLocalAttempt || !effective.complete : !effective.complete;
}

function explainLocalAudioFeatureCandidate(track: any, options: {
  reprocessLocal?: boolean;
  reprocessApiWithLocal?: boolean;
  preferLocal?: boolean;
  allowEstimated?: boolean;
  analysisScope?: string | null;
}) {
  const feature = track.audioFeature || {};
  const effective = getEffectiveAudioFeatures(track, {
    preferLocalAudioFeatures: options.preferLocal ?? true,
    allowEstimated: options.allowEstimated ?? true,
  });
  const selected = needsLocalAudioFeatureBackfill(track, options);
  return {
    track: trackLabel(track),
    audioFeatureStatus: feature.audioFeatureStatus ?? null,
    audioFeatureSource: feature.audioFeatureSource ?? null,
    audioFeatureAnalysisScope: feature.audioFeatureAnalysisScope ?? null,
    energy: feature.energy ?? null,
    mood: feature.valence ?? null,
    danceability: feature.danceability ?? null,
    acousticness: feature.acousticness ?? null,
    tempo: feature.tempo ?? null,
    effectiveEnergy: effective.energy,
    effectiveMood: effective.mood,
    effectiveDanceability: effective.danceability,
    effectiveAcousticness: effective.acousticness,
    effectiveTempo: effective.tempo,
    effectiveComplete: effective.complete,
    missingFields: effective.missingFields,
    selected,
  };
}

const localAudioFeatureTrackSelect = {
  id: true,
  title: true,
  plexId: true,
  ratingKey: true,
  duration: true,
  mediaPath: true,
  syncStatus: true,
  artist: { select: { title: true } },
  album: { select: { title: true } },
  library: {
    select: {
      id: true,
      name: true,
      server: { select: { uri: true, accessToken: true } },
    },
  },
  audioFeature: true,
} as const;

export const runLocalAudioFeatureEngine = async (options: SyncEngineOptions = {}): Promise<EnrichmentRunSummary> => {
  console.log("[LocalAudioFeatureEngine] Starting local audio feature backfill.");
  let summary: EnrichmentRunSummary = { attempted: 0, processed: 0, skipped: 0, failed: 0 };

  const metadataSettings = logMetadataProviderSettings(options).audioFeatures;
  if (!metadataSettings.local) {
    console.log("[LocalAudioFeatureEngine] Local audio feature analysis is disabled.");
    return summary;
  }

  installShutdownHandlers();
  localAudioFeatureGlobals.mixarrLocalAudioFeatureShutdownRequested = false;
  const lock = acquireJobLock({
    name: "local Essentia audio feature backfill",
    keys: [LOCAL_AUDIO_FEATURE_JOB_KEY],
    source: "local-audio-feature-engine",
  });
  if (!lock.acquired) {
    console.warn(
      `[LocalAudioFeatureEngine] Duplicate local audio feature backfill ignored; ${lock.activeJob.name} started at ${lock.activeJob.startedAt}.`,
    );
    return summary;
  }

  try {
    await assertEssentiaAvailable();
    const batchSize = resolveLimit(options.audioFeatureBatchSize, "AUDIO_FEATURE_BATCH_SIZE");
    const providerDelayMs = resolveDelayMs(options.providerDelayMs, 250);
    const allowEstimatedMoodAcousticness = metadataSettings.allowEstimated;
    const reprocessLocal = boolSetting(options.reprocessLocalAudioFeatures, "LOCAL_AUDIO_FEATURE_REPROCESS", false);
    const analysisScope = metadataSettings.scope;
    console.log(`[LocalAudioFeatureEngine] Local audio feature analyzer selected: Essentia; scope=${analysisScope}.`);
    if (analysisScope === "whole_track") {
      console.log(`[LocalAudioFeatureEngine] Whole-track mode uses concurrency=${localAudioFeatureConcurrency}.`);
    }
    const where = localAudioFeatureWhere(reprocessLocal, metadataSettings.reprocessApiWithLocal, analysisScope);
    const candidateCount = await prisma.track.count({ where });
    await safeTrackBatchIterator<any>({
      engineName: "LocalAudioFeatureEngineCandidatePreview",
      where,
      orderBy: [{ addedAt: "desc" }, { id: "asc" }],
      take: 10,
      select: localAudioFeatureTrackSelect,
      process: async (candidate) => {
        const reason = explainLocalAudioFeatureCandidate(candidate, {
          reprocessLocal,
          reprocessApiWithLocal: metadataSettings.reprocessApiWithLocal,
          preferLocal: metadataSettings.preferLocal,
          allowEstimated: allowEstimatedMoodAcousticness,
          analysisScope,
        });
        console.log("[LocalAudioFeatureEngine] Candidate reason:", reason);
        if (reason.effectiveComplete && reason.selected) {
          console.error("[LocalAudioFeatureEngine] BUG: selected completed local_essentia audio feature track.", {
            track: reason.track,
            audioFeatureStatus: reason.audioFeatureStatus,
            audioFeatureSource: reason.audioFeatureSource,
          });
        }
        return "skipped";
      },
    });
    const startedAt = Date.now();
    let alreadyAnalyzed = 0;
    let progressProcessed = 0;
    let progressFailed = 0;
    let shutdownLogged = false;
    console.log(`[LocalAudioFeatureEngine] Found ${candidateCount} tracks needing local Essentia audio feature backfill.`);
    engineBatchSize.observe({ engine: ENGINE }, Math.min(candidateCount, batchSize || candidateCount));

    const logProgress = (force = false) => {
      const completed = progressProcessed + alreadyAnalyzed + progressFailed;
      if (!force && completed > 0 && completed % 25 !== 0) return;
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      const remaining = Math.max(0, candidateCount - completed);
      console.log(
        `[LocalAudioFeatureEngine] Progress: processed=${progressProcessed} alreadyAnalyzed=${alreadyAnalyzed} failed=${progressFailed} remaining=${remaining} elapsed=${elapsedSeconds}s`,
      );
    };

    summary = await safeTrackBatchIterator<any>({
      engineName: "LocalAudioFeatureEngine",
      where,
      orderBy: [{ addedAt: "desc" }, { id: "asc" }],
      select: localAudioFeatureTrackSelect,
      ...(batchSize ? { take: batchSize } : {}),
      process: async (track) => {
        let outcome: "success" | "not_found" | "error" = "success";
        const endTimer = trackDurationSeconds.startTimer({ engine: ENGINE });
        try {
          if (shutdownRequested()) {
            if (!shutdownLogged) {
              shutdownLogged = true;
              console.warn(
                `[LocalAudioFeatureEngine] Shutdown requested. Stopping before next track. processed=${progressProcessed} alreadyAnalyzed=${alreadyAnalyzed} failed=${progressFailed}.`,
              );
            }
            alreadyAnalyzed += 1;
            return "skipped";
          }

          const freshTrack = await prisma.track.findUnique({
            where: { id: track.id },
            select: localAudioFeatureTrackSelect,
          });
          if (!freshTrack || !needsLocalAudioFeatureBackfill(freshTrack, {
            reprocessLocal,
            reprocessApiWithLocal: metadataSettings.reprocessApiWithLocal,
            preferLocal: metadataSettings.preferLocal,
            allowEstimated: allowEstimatedMoodAcousticness,
            analysisScope,
          })) {
            alreadyAnalyzed += 1;
            const effective = freshTrack ? getEffectiveAudioFeatures(freshTrack, {
              preferLocalAudioFeatures: metadataSettings.preferLocal,
              allowEstimated: allowEstimatedMoodAcousticness,
            }) : null;
            if (
              freshTrack?.audioFeature?.audioFeatureSource === "local_essentia"
              && freshTrack.audioFeature.audioFeatureStatus === "success"
              && effective?.complete
            ) {
              console.log(`[LocalAudioFeatureEngine] Retry item skipped because track already has complete local_essentia audio features: ${trackLabel(freshTrack)}`);
            } else {
              debugLog(`[LocalAudioFeatureEngine] Skipping already analyzed track ${track.id} ${trackLabel(track)}.`);
            }
            logProgress();
            return "skipped";
          }

          const localFeatures = await analyzeTrackLocally(freshTrack, analysisScope);
          if (localFeatures) {
            await saveLocalFeatures(freshTrack, localFeatures, {
              preferLocal: metadataSettings.preferLocal,
              force: reprocessLocal,
              allowEstimatedMoodAcousticness,
            });
            progressProcessed += 1;
          } else {
            outcome = "not_found";
            await saveFailure(freshTrack.id, "no_data", analysisScope, "Essentia analysis completed but produced no usable descriptors.");
            progressProcessed += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (error instanceof ShortTrackAudioFeatureError) {
            outcome = "not_found";
            await saveFailure(track.id, "too_short", analysisScope, message);
            progressProcessed += 1;
            console.warn(
              `[LocalAudioFeatureEngine] Persisting audio feature short-track marker for track ${track.id} (too_short)`,
            );
          } else if (error instanceof ExtractionFailedAudioFeatureError) {
            outcome = "error";
            progressFailed += 1;
            await saveFailure(track.id, "extraction_failed", analysisScope, message);
            console.error(`[LocalAudioFeatureEngine] Extraction failed ${trackLabel(track)}: ${message}`);
          } else if (error instanceof AnalyzerFailedAudioFeatureError) {
            outcome = "error";
            progressFailed += 1;
            await saveFailure(track.id, "analyzer_failed", analysisScope, message);
            console.error(`[LocalAudioFeatureEngine] Analyzer failed ${trackLabel(track)}: ${message}`);
          } else {
            outcome = "error";
            progressFailed += 1;
            await saveFailure(track.id, "analyzer_failed", analysisScope, message);
            console.error(`[LocalAudioFeatureEngine] Failed ${trackLabel(track)}: ${message}`);
          }
          console.warn(`[LocalAudioFeatureEngine] Track analysis failed but worker will continue: reason=${message}`);
        } finally {
          endTimer();
          trackAttemptsTotal.inc({ engine: ENGINE, result: outcome });
        }

        if (providerDelayMs > 0) await sleep(providerDelayMs);
        logProgress();
        return outcome === "error" ? "failed" : "processed";
      },
    });
    logProgress(true);

    const [api, local, noData, tooShort, failed] = await runWithConcurrency([
      () => prisma.audioFeature.count({ where: { audioFeatureSource: "api", track: { syncStatus: "active" } } }),
      () => prisma.audioFeature.count({ where: { audioFeatureSource: { in: ["local_essentia", "mixed"] }, track: { syncStatus: "active" } } }),
      () => prisma.audioFeature.count({ where: { audioFeatureStatus: "no_data", track: { syncStatus: "active" } } }),
      () => prisma.audioFeature.count({ where: { audioFeatureStatus: "too_short", track: { syncStatus: "active" } } }),
      () => prisma.audioFeature.count({ where: { audioFeatureStatus: { in: ["extraction_failed", "analyzer_failed"] }, track: { syncStatus: "active" } } }),
    ], resolveDbJobConcurrency());
    console.log(`[LocalAudioFeatureEngine] Completed: api=${api} local=${local} no_data=${noData} too_short=${tooShort} failed=${failed}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[LocalAudioFeatureEngine] Sync failed: ${message}`);
  } finally {
    lock.release();
  }

  return summary;
};

export { completeAudioFeatureWhere };
