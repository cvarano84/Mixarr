import { mkdir, mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import prisma from "./prisma";
import {
  assertEssentiaAvailable,
  buildAudioInputSourcesForTrack,
  buildBpmSampleWindows,
  decodeAudioSourceToWav,
  extractAudioSampleFromSources,
  redactSensitiveUrl,
  runCommand,
  validateAudioSample,
  type AudioInputSource,
} from "./localBpmEngine";
import {
  audioFeatureAnalyzerFailedTrackWhere,
  audioFeatureExtractionFailedTrackWhere,
  completeAudioFeatureWhere,
  missingAudioFeatureTrackWhere,
  type AudioFeatureStatus,
} from "./audioFeatures";
import {
  resolveDelayMs,
  resolveLimit,
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

const ENGINE = "audio_feature";
const essentiaPythonPath = process.env.LOCAL_BPM_ESSENTIA_PYTHON || "/opt/essentia/bin/python";
const featureTempRoot = process.env.LOCAL_AUDIO_FEATURE_TEMP_DIR || path.join(os.tmpdir(), "mixarr-audio-features");

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

function boolSetting(userValue: boolean | null | undefined, envName: string, defaultValue: boolean) {
  if (typeof userValue === "boolean") return userValue;
  const envValue = process.env[envName];
  if (envValue === undefined) return defaultValue;
  return ["1", "true", "yes", "on"].includes(envValue.trim().toLowerCase());
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

function fullTrackTimeoutMs(track: any) {
  const durationSeconds = track.duration ? Number(track.duration) / 1000 : 0;
  return Math.max(300000, Math.ceil(Math.max(durationSeconds, 60) * 2500));
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
    const validation = await validateAudioSample(source.input);
    if (validation.ok) {
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
    validation = await decodeAudioSourceToWav(source, wavPath, timeoutMs);
  } catch (error) {
    throw new ExtractionFailedAudioFeatureError(
      `ffmpeg could not decode whole-track WAV from ${source.type}: ${redactedMessage(error)}`,
    );
  }
  if (!validation.ok) {
    throw new ExtractionFailedAudioFeatureError(
      `Decoded whole-track WAV did not validate from ${source.type}: ${validation.reason || "unknown validation failure"}`,
    );
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
    console.log(`[LocalAudioFeatureEngine] Analyzing ${trackLabel(track)} using ${source.type} whole_track.`);

    try {
      const result = await analyzeWholeTrackSource(track, source, tempDir, index);
      validatedSourceCount += 1;
      if (result) return result;
    } catch (error) {
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
      const message = redactedMessage(error);
      extractionErrors.push(`${sampleWindow.label}: ${message}`);
      console.warn(`[LocalAudioFeatureEngine] Skipping ${sampleWindow.label} sample for "${trackLabel(track)}": ${message}`);
      continue;
    }

    try {
      console.log(`[LocalAudioFeatureEngine] Analyzing ${trackLabel(track)} using ${sourceType} windows.`);
      const analysis = await analyzeSampleWithEssentia(wavPath);
      if (analysis) {
        results.push(analysis);
        console.log(
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
    if (scope === "whole_track") {
      return analyzeTrackWholeTrack(track, tempDir);
    }

    return analyzeTrackWindows(track, tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
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

function audioFeatureStatusFor(data: Record<string, unknown>): AudioFeatureStatus {
  const required = ["energy", "valence", "danceability", "acousticness", "tempo"];
  const present = required.filter((field) => data[field] !== null && data[field] !== undefined).length;
  if (present === required.length) return "success";
  if (present > 0) return "partial";
  return "no_data";
}

async function saveLocalFeatures(track: any, result: LocalAudioFeatureResult, options: {
  preferApi: boolean;
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

  const setField = (field: string, sourceField: string, value: number | null, source: string) => {
    if (value === null || shouldKeepExistingField(existing, field, sourceField, options.preferApi, options.force)) {
      update[field] = existing[field] ?? null;
      update[sourceField] = existing[sourceField] ?? null;
      return;
    }
    update[field] = value;
    update[sourceField] = source;
  };

  setField("energy", "energySource", result.energy, "local_essentia");
  setField("danceability", "danceabilitySource", result.danceability, "local_heuristic");
  if (options.allowEstimatedMoodAcousticness) {
    setField("valence", "valenceSource", result.valence, "local_heuristic");
    setField("acousticness", "acousticnessSource", result.acousticness, "local_heuristic");
  }
  if (result.tempo !== null && !shouldKeepExistingField(existing, "tempo", "tempoSource", options.preferApi, options.force)) {
    update.tempo = result.tempo;
    update.tempoSource = "Essentia local audio feature analysis";
    update.tempoConfidence = result.tempoConfidence;
  } else {
    update.tempo = existing.tempo ?? null;
    update.tempoSource = existing.tempoSource ?? null;
    update.tempoConfidence = existing.tempoConfidence ?? null;
  }

  update.audioFeatureStatus = audioFeatureStatusFor(update);
  update.audioFeatureSource = isApiOwnedSource(existing.source, existing.audioFeatureSource)
    && Object.values(update).some((value) => value !== null && value !== undefined)
    ? "mixed"
    : "local_essentia";
  update.source = existing.source && isApiOwnedSource(existing.source, existing.audioFeatureSource)
    ? existing.source
    : "Essentia local audio analysis";
  update.confidence = Math.max(Number(existing.confidence) || 0, result.confidence);

  await prisma.audioFeature.upsert({
    where: { trackId: track.id },
    update,
    create: {
      trackId: track.id,
      ...update,
    } as any,
  });

  console.log(
    `[LocalAudioFeatureEngine] ${trackLabel(track)} -> energy=${result.energy.toFixed(2)} mood=${result.valence.toFixed(2)} danceability=${result.danceability.toFixed(2)} acousticness=${result.acousticness.toFixed(2)} bpm=${result.tempo?.toFixed(1) || "n/a"} source=local_essentia scope=${result.analysisScope} confidence=${result.confidence.toFixed(2)}`,
  );
  console.log(`[LocalAudioFeatureEngine] Persisted local audio features for track ${track.id}.`);
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

function localAudioFeatureWhere(reprocessLocal: boolean) {
  if (reprocessLocal) {
    return {
      syncStatus: "active",
      OR: [
        missingAudioFeatureTrackWhere(),
        { audioFeature: { is: { audioFeatureSource: { in: ["local_essentia", "local_heuristic", "mixed"] } } } },
        audioFeatureExtractionFailedTrackWhere(),
        audioFeatureAnalyzerFailedTrackWhere(),
      ],
    };
  }

  return {
    AND: [
      { syncStatus: "active" },
      missingAudioFeatureTrackWhere(),
      { NOT: audioFeatureExtractionFailedTrackWhere() },
      { NOT: audioFeatureAnalyzerFailedTrackWhere() },
    ],
  };
}

export const runLocalAudioFeatureEngine = async (options: SyncEngineOptions = {}): Promise<EnrichmentRunSummary> => {
  console.log("[LocalAudioFeatureEngine] Starting local audio feature backfill.");
  let summary: EnrichmentRunSummary = { attempted: 0, processed: 0, skipped: 0, failed: 0 };

  const enabled = boolSetting(options.enableLocalAudioFeatureFallback, "LOCAL_AUDIO_FEATURE_FALLBACK_ENABLED", true);
  if (!enabled) {
    console.log("[LocalAudioFeatureEngine] Local audio feature fallback is disabled.");
    return summary;
  }

  try {
    await assertEssentiaAvailable();
    const batchSize = resolveLimit(options.audioFeatureBatchSize, "AUDIO_FEATURE_BATCH_SIZE");
    const providerDelayMs = resolveDelayMs(options.providerDelayMs, 250);
    const preferApi = boolSetting(options.preferApiAudioFeatures, "LOCAL_AUDIO_FEATURE_PREFER_API", true);
    const allowEstimatedMoodAcousticness = boolSetting(options.allowEstimatedMoodAcousticness, "LOCAL_AUDIO_FEATURE_ALLOW_ESTIMATED_MOOD", true);
    const reprocessLocal = boolSetting(options.reprocessLocalAudioFeatures, "LOCAL_AUDIO_FEATURE_REPROCESS", false);
    const analysisScope = resolveAudioFeatureAnalysisScope(options.localAudioFeaturesScope);
    console.log(`[LocalAudioFeatureEngine] Local audio feature analyzer selected: Essentia; scope=${analysisScope}.`);
    const where = localAudioFeatureWhere(reprocessLocal);
    const candidateCount = await prisma.track.count({ where });
    console.log(`[LocalAudioFeatureEngine] Found ${candidateCount} tracks missing audio features.`);
    engineBatchSize.observe({ engine: ENGINE }, Math.min(candidateCount, batchSize || candidateCount));

    summary = await safeTrackBatchIterator<any>({
      engineName: "LocalAudioFeatureEngine",
      where,
      orderBy: [{ addedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        title: true,
        plexId: true,
        ratingKey: true,
        duration: true,
        mediaPath: true,
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
      },
      ...(batchSize ? { take: batchSize } : {}),
      process: async (track) => {
        let outcome: "success" | "not_found" | "error" = "success";
        const endTimer = trackDurationSeconds.startTimer({ engine: ENGINE });
        try {
          const localFeatures = await analyzeTrackLocally(track, analysisScope);
          if (localFeatures) {
            await saveLocalFeatures(track, localFeatures, {
              preferApi,
              force: reprocessLocal,
              allowEstimatedMoodAcousticness,
            });
          } else {
            outcome = "not_found";
            await saveFailure(track.id, "no_data", analysisScope, "Essentia analysis completed but produced no usable descriptors.");
          }
        } catch (error) {
          outcome = "error";
          const message = error instanceof Error ? error.message : String(error);
          if (error instanceof ExtractionFailedAudioFeatureError) {
            await saveFailure(track.id, "extraction_failed", analysisScope, message);
            console.error(`[LocalAudioFeatureEngine] Extraction failed ${trackLabel(track)}: ${message}`);
          } else if (error instanceof AnalyzerFailedAudioFeatureError) {
            await saveFailure(track.id, "analyzer_failed", analysisScope, message);
            console.error(`[LocalAudioFeatureEngine] Analyzer failed ${trackLabel(track)}: ${message}`);
          } else {
            await saveFailure(track.id, "analyzer_failed", analysisScope, message);
            console.error(`[LocalAudioFeatureEngine] Failed ${trackLabel(track)}: ${message}`);
          }
        } finally {
          endTimer();
          trackAttemptsTotal.inc({ engine: ENGINE, result: outcome });
        }

        if (providerDelayMs > 0) await sleep(providerDelayMs);
        return outcome === "error" ? "failed" : "processed";
      },
    });

    const [api, local, noData, failed] = await runWithConcurrency([
      () => prisma.audioFeature.count({ where: { audioFeatureSource: "api", track: { syncStatus: "active" } } }),
      () => prisma.audioFeature.count({ where: { audioFeatureSource: { in: ["local_essentia", "mixed"] }, track: { syncStatus: "active" } } }),
      () => prisma.audioFeature.count({ where: { audioFeatureStatus: "no_data", track: { syncStatus: "active" } } }),
      () => prisma.audioFeature.count({ where: { audioFeatureStatus: { in: ["extraction_failed", "analyzer_failed"] }, track: { syncStatus: "active" } } }),
    ], resolveDbJobConcurrency());
    console.log(`[LocalAudioFeatureEngine] Completed: api=${api} local=${local} no_data=${noData} failed=${failed}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[LocalAudioFeatureEngine] Sync failed: ${message}`);
  }

  return summary;
};

export { completeAudioFeatureWhere };
