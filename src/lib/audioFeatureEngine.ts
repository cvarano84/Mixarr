import prisma from "./prisma";
import { getSpotifyAudioFeatures } from "./providers/spotify";
import { getAudioDbFeatures } from "./providers/audiodb";
import { getDeezerBpm } from "./providers/deezer";
import { isRateLimitError } from "./providers/rateLimit";
import {
  resolveDelayMs,
  resolveLimit,
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
import { completeAudioFeatureWhere } from "./audioFeatures";

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
  const required = ["energy", "valence", "danceability", "tempo"];
  const present = required.filter((field) => data[field] !== null && data[field] !== undefined).length;
  if (present === required.length) return "success";
  if (present > 0) return "partial";
  return "no_data";
}

// One batch of audio-feature enrichment. The scheduler uses attempted=0
// to know when the queue is drained.
export const runAudioFeatureEngine = async (options: SyncEngineOptions = {}): Promise<EnrichmentRunSummary> => {
  console.log("[AudioFeatureEngine] Starting background audio features sync...");

  let summary: EnrichmentRunSummary = { attempted: 0, processed: 0, skipped: 0, failed: 0 };

  try {
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
          const source = sanitizeRequiredMetadataString(features?.source || (bpm ? "Deezer BPM only" : "estimated"), { entity: "AudioFeature", entityId: track.id, field: "source" });
          const tempoSource = sanitizeRequiredMetadataString(bpm ? "Deezer" : (features ? features.source : "estimated"), { entity: "AudioFeature", entityId: track.id, field: "tempoSource" });
          const confidence = features?.source === "Spotify Audio Features" ? 0.95 : (features ? 0.65 : 0.35);
          const tempoConfidence = bpm ? 0.9 : (features ? 0.45 : 0.2);
          const data = {
            energy: finalEnergy,
            valence: finalValence,
            danceability: finalDanceability,
            acousticness: finalAcousticness,
            tempo: finalTempo,
            source,
            confidence,
            tempoSource,
            tempoConfidence,
            audioFeatureSource: features ? "api" : null,
            audioFeatureStatus: featureStatus({
              energy: finalEnergy,
              valence: finalValence,
              danceability: finalDanceability,
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
