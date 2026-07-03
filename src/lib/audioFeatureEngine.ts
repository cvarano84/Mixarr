import prisma from "./prisma";
import { getSpotifyAudioFeatures } from "./providers/spotify";
import { getAudioDbFeatures } from "./providers/audiodb";
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
import { sanitizeRequiredMetadataString } from "./metadataSanitizer";
import { completeAudioFeatureWhere, getEffectiveAudioFeatures } from "./audioFeatures";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const ENGINE = "audio_feature";

// How long we wait before retrying a track that previously failed to enrich.
// We store the failure as an all-null marker row, and re-attempt anything
// older than this so transient outages don't burn a track in permanently.
const RETRY_AFTER_DAYS = 14;
const RETRY_MS = RETRY_AFTER_DAYS * 24 * 60 * 60 * 1000;

function hasRealFeaturePayload(features: any) {
  return features && (
    features.energy !== null && features.energy !== undefined ||
    features.valence !== null && features.valence !== undefined ||
    features.danceability !== null && features.danceability !== undefined ||
    features.acousticness !== null && features.acousticness !== undefined ||
    features.tempo !== null && features.tempo !== undefined
  );
}

function featureStatus(data: Record<string, unknown>) {
  const required = ["energy", "valence", "danceability", "acousticness", "tempo"];
  const present = required.filter((field) => data[field] !== null && data[field] !== undefined).length;
  if (present === required.length) return "success";
  if (present > 0) return "partial";
  return "no_data";
}

function effectiveAudioFeatureData(existing: any, api: {
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  acousticness: number | null;
  loudness: number | null;
}, preferLocal: boolean, allowEstimated: boolean) {
  const merged = {
    ...existing,
    apiEnergy: api.energy,
    apiMood: api.valence,
    apiDanceability: api.danceability,
    apiAcousticness: api.acousticness,
    apiLoudness: api.loudness,
    audioFeatureStatus: "success",
    audioFeatureSource: existing?.audioFeatureSource === "local_essentia" ? "mixed" : existing?.audioFeatureSource || "api",
  };
  const effective = getEffectiveAudioFeatures({ audioFeature: merged }, {
    preferLocalAudioFeatures: preferLocal,
    allowEstimated,
  });

  return {
    energy: effective.energy,
    valence: effective.valence,
    danceability: effective.danceability,
    acousticness: effective.acousticness,
    loudness: preferLocal
      ? (existing?.localLoudness ?? api.loudness ?? null)
      : (api.loudness ?? existing?.localLoudness ?? null),
    source: api.energy !== null || api.valence !== null || api.danceability !== null || api.acousticness !== null
      ? existing?.localEnergy !== null && existing?.localEnergy !== undefined ? "mixed" : "api"
      : existing?.audioFeatureSource || null,
  };
}

// One batch of audio-feature enrichment. The scheduler uses attempted=0
// to know when the queue is drained.
export const runAudioFeatureEngine = async (options: SyncEngineOptions = {}): Promise<EnrichmentRunSummary> => {
  console.log("[AudioFeatureEngine] Starting background audio features sync...");

  let summary: EnrichmentRunSummary = { attempted: 0, processed: 0, skipped: 0, failed: 0 };

  try {
    const metadataSettings = logMetadataProviderSettings(options).audioFeatures;
    if (!metadataSettings.api) {
      console.log("[AudioFeatureEngine] API audio features disabled; using local Essentia.");
      return summary;
    }
    const batchSize = resolveLimit(options.audioFeatureBatchSize, "AUDIO_FEATURE_BATCH_SIZE");
    const providerDelayMs = resolveDelayMs(options.providerDelayMs, 250);
    const rateLimitBackoffEnabled = resolveRateLimitBackoff(options.rateLimitBackoffEnabled);
    const retryThreshold = new Date(Date.now() - RETRY_MS);
    const where = {
      syncStatus: "active",
      OR: [
        { audioFeature: null },
        {
          audioFeature: {
            is: {
              AND: [
                { NOT: completeAudioFeatureWhere() },
                { lastUpdated: { lt: retryThreshold } },
              ],
            },
          },
        },
      ],
    };
    const candidateCount = await prisma.track.count({ where });
    console.log(`[AudioFeatureEngine] Found ${candidateCount} tracks missing final audio features and eligible for remote/API lookup.`);
    engineBatchSize.observe({ engine: ENGINE }, Math.min(candidateCount, batchSize || candidateCount));

    summary = await safeTrackBatchIterator<any>({
      engineName: "AudioFeatureEngine",
      where,
      select: {
        id: true,
        title: true,
        ratingKey: true,
        libraryId: true,
        artist: { select: { title: true } },
        audioFeature: true,
      },
      ...(batchSize ? { take: batchSize } : {}),
      process: async (track) => {
      let outcome: "success" | "not_found" | "rate_limited" | "error" = "success";
      const endTimer = trackDurationSeconds.startTimer({ engine: ENGINE });
      try {
        let rateLimited = false;
        let features = null;
        let bpm = null;

        try {
          const spotifyFeatures = await getSpotifyAudioFeatures(track.artist.title, track.title);
          if (spotifyFeatures) {
            features = {
              ...spotifyFeatures,
              source: "Spotify Audio Features",
            };
          }
        } catch (error) {
          if (!isRateLimitError(error) || rateLimitBackoffEnabled) throw error;
          rateLimited = true;
          console.warn(
            `[AudioFeatureEngine] Spotify rate-limited for "${track.artist.title} - ${track.title}"; trying AudioDB and Deezer fallbacks.`,
          );
        }

        try {
          if (!features) {
            features = await getAudioDbFeatures(track.artist.title, track.title);
          }
        } catch (error) {
          if (!isRateLimitError(error) || rateLimitBackoffEnabled) throw error;
          rateLimited = true;
          console.warn(
            `[AudioFeatureEngine] AudioDB rate-limited for "${track.artist.title} - ${track.title}"; trying Deezer BPM.`,
          );
        }

        try {
          bpm = await getDeezerBpm(track.artist.title, track.title);
        } catch (error) {
          if (!isRateLimitError(error) || rateLimitBackoffEnabled) throw error;
          rateLimited = true;
          console.warn(
            `[AudioFeatureEngine] Deezer rate-limited for "${track.artist.title} - ${track.title}"; keeping any feature fallback.`,
          );
        }

        if (hasRealFeaturePayload(features) || bpm) {
          const finalEnergy = features?.energy ?? null;
          const finalValence = features?.valence ?? null;
          const finalDanceability = features?.danceability ?? null;
          const finalAcousticness = features?.acousticness ?? null;
          const finalTempo = bpm ?? features?.tempo ?? null;
          const finalLoudness = features?.loudness ?? null;
          const source = sanitizeRequiredMetadataString(features?.source || (bpm ? "Deezer BPM only" : "estimated"), { entity: "AudioFeature", entityId: track.id, field: "source" });
          const tempoSource = sanitizeRequiredMetadataString(bpm ? "Deezer" : (features ? features.source : "estimated"), { entity: "AudioFeature", entityId: track.id, field: "tempoSource" });
          const confidence = features?.source === "Spotify Audio Features" ? 0.95 : (features ? 0.65 : 0.35);
          const tempoConfidence = bpm ? 0.9 : (features ? 0.45 : 0.2);
          const effective = effectiveAudioFeatureData(track.audioFeature, {
            energy: finalEnergy,
            valence: finalValence,
            danceability: finalDanceability,
            acousticness: finalAcousticness,
            loudness: finalLoudness,
          }, metadataSettings.preferLocal, metadataSettings.allowEstimated);
          const data = {
            apiEnergy: finalEnergy,
            apiMood: finalValence,
            apiDanceability: finalDanceability,
            apiAcousticness: finalAcousticness,
            apiLoudness: finalLoudness,
            energy: effective.energy,
            valence: effective.valence,
            danceability: effective.danceability,
            acousticness: effective.acousticness,
            effectiveEnergy: effective.energy,
            effectiveMood: effective.valence,
            effectiveDanceability: effective.danceability,
            effectiveAcousticness: effective.acousticness,
            tempo: finalTempo,
            loudness: effective.loudness,
            source,
            confidence,
            tempoSource,
            tempoConfidence,
            audioFeatureSource: features ? effective.source : track.audioFeature?.audioFeatureSource ?? null,
            audioFeatureStatus: featureStatus({
              energy: effective.energy,
              valence: effective.valence,
              danceability: effective.danceability,
              acousticness: effective.acousticness,
              tempo: finalTempo,
            }),
            audioFeatureConfidence: confidence,
            audioFeatureAnalyzedAt: new Date(),
            audioFeatureFailureReason: null,
            energySource: finalEnergy !== null ? "api" : null,
            valenceSource: finalValence !== null ? "api" : null,
            danceabilitySource: finalDanceability !== null ? "api" : null,
            acousticnessSource: finalAcousticness !== null ? "api" : null,
            lastUpdated: new Date(),
          };
          data.energySource = effective.energy !== null && effective.energy === finalEnergy ? "api" : effective.energy !== null && effective.energy === track.audioFeature?.localEnergy ? "local_essentia" : data.energySource;
          data.valenceSource = effective.valence !== null && effective.valence === finalValence ? "api" : effective.valence !== null && effective.valence === track.audioFeature?.localMood ? "local_essentia" : data.valenceSource;
          data.danceabilitySource = effective.danceability !== null && effective.danceability === finalDanceability ? "api" : effective.danceability !== null && effective.danceability === track.audioFeature?.localDanceability ? "local_essentia" : data.danceabilitySource;
          data.acousticnessSource = effective.acousticness !== null && effective.acousticness === finalAcousticness ? "api" : effective.acousticness !== null && effective.acousticness === track.audioFeature?.localAcousticness ? "local_essentia" : data.acousticnessSource;

          await prisma.audioFeature.upsert({
            where: { trackId: track.id },
            update: data,
            create: { trackId: track.id, ...data },
          });
          console.log(`[AudioFeatureEngine] Track "${track.title}" -> Energy: ${finalEnergy}, Mood: ${finalValence}, BPM: ${finalTempo}`);
        } else if (rateLimited) {
          outcome = "rate_limited";
          console.warn(`[AudioFeatureEngine] Rate-limited providers had no fallback result for "${track.artist.title} - ${track.title}"; leaving it queued.`);
        } else {
          await prisma.audioFeature.upsert({
            where: { trackId: track.id },
            update: { energy: null, valence: null, danceability: null, acousticness: null, tempo: null, source: "not_found", confidence: 0, tempoSource: "not_found", tempoConfidence: 0, audioFeatureSource: null, audioFeatureStatus: "no_data", audioFeatureConfidence: 0, audioFeatureAnalyzedAt: new Date(), audioFeatureFailureReason: "No API provider returned audio features.", lastUpdated: new Date() },
            create: { trackId: track.id, source: "not_found", confidence: 0, tempoSource: "not_found", tempoConfidence: 0, audioFeatureStatus: "no_data", audioFeatureConfidence: 0, audioFeatureAnalyzedAt: new Date(), audioFeatureFailureReason: "No API provider returned audio features.", lastUpdated: new Date() },
          });
          outcome = "not_found";
        }
      } catch (e: any) {
        if (isRateLimitError(e) || e.message === "NO_TOKEN") {
          outcome = "rate_limited";
          console.warn(`[AudioFeatureEngine] Rate-limited while looking up "${track.artist.title} - ${track.title}" (${e.message}); leaving it queued.`);
        } else {
          console.error(`[AudioFeatureEngine] Unexpected error on track ${track.title}:`, e.message);
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

    console.log(`[AudioFeatureEngine] Audio features sync batch completed! (${summary.attempted} attempted, ${summary.skipped} skipped, ${summary.failed} failed)`);
  } catch (error) {
    console.error("[AudioFeatureEngine] Sync failed", error);
  }

  return summary;
};
