import prisma from "./prisma";
import { getSpotifyAudioFeatures } from "./providers/spotify";
import { getAudioDbFeatures } from "./providers/audiodb";
import { getDeezerBpm } from "./providers/deezer";
import { isRateLimitError } from "./providers/rateLimit";
import { resolveDelayMs, resolveLimit, type SyncEngineOptions } from "./syncSettings";
import {
  engineBatchSize,
  trackAttemptsTotal,
  trackDurationSeconds,
} from "./metrics";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const ENGINE = "audio_feature";

// How long we wait before retrying a track that previously failed to enrich.
// We store the failure as an all-null marker row, and re-attempt anything
// older than this so transient outages don't burn a track in permanently.
const RETRY_AFTER_DAYS = 14;
const RETRY_MS = RETRY_AFTER_DAYS * 24 * 60 * 60 * 1000;

// One batch of audio-feature enrichment. Returns the number of tracks we
// attempted, which the scheduler uses to know when the queue is drained.
export const runAudioFeatureEngine = async (options: SyncEngineOptions = {}): Promise<number> => {
  console.log("[AudioFeatureEngine] Starting background audio features sync...");

  let attempted = 0;

  try {
    const batchSize = resolveLimit(options.audioFeatureBatchSize, "AUDIO_FEATURE_BATCH_SIZE");
    const providerDelayMs = resolveDelayMs(options.providerDelayMs, 250);
    const retryThreshold = new Date(Date.now() - RETRY_MS);
    const tracksToProcess = await prisma.track.findMany({
      where: {
        OR: [
          // Never attempted
          { audioFeature: null },
          // Previously marked all-null (the "nobody had anything" shape) and
          // the retry window has elapsed. Rows where localBpmEngine later set
          // tempo won't match because their tempo isn't null.
          {
            audioFeature: {
              energy: null,
              valence: null,
              danceability: null,
              tempo: null,
              lastUpdated: { lt: retryThreshold },
            },
          },
        ],
      },
      include: { artist: true },
      ...(batchSize ? { take: batchSize } : {}),
    });

    console.log(`[AudioFeatureEngine] Found ${tracksToProcess.length} tracks needing audio features.`);
    engineBatchSize.observe({ engine: ENGINE }, tracksToProcess.length);

    for (const track of tracksToProcess) {
      attempted += 1;
      let outcome: "success" | "not_found" | "rate_limited" | "error" = "success";
      const endTimer = trackDurationSeconds.startTimer({ engine: ENGINE });
      try {
        // 1. Try AudioDB (Only reliable source left since Spotify killed their Audio Features API)
        let features = await getAudioDbFeatures(track.artist.title, track.title);
        
        // 2. Try Deezer specifically for accurate BPM
        let bpm = await getDeezerBpm(track.artist.title, track.title);

        if (features || bpm) {
          // Merge Deezer BPM into AudioDB features if available
          const finalEnergy = features ? features.energy : 0.5;
          const finalValence = features ? features.valence : 0.5;
          const finalDanceability = features ? features.danceability : 0.5;
          const finalTempo = bpm ? bpm : (features ? features.tempo : 120);
          const source = features?.source || (bpm ? "Deezer BPM only" : "estimated");
          const tempoSource = bpm ? "Deezer" : (features ? features.source : "estimated");
          const confidence = features ? 0.65 : 0.35;
          const tempoConfidence = bpm ? 0.9 : (features ? 0.45 : 0.2);

          await prisma.audioFeature.upsert({
            where: { trackId: track.id },
            update: {
              energy: finalEnergy,
              valence: finalValence,
              danceability: finalDanceability,
              tempo: finalTempo,
              source,
              confidence,
              tempoSource,
              tempoConfidence,
              lastUpdated: new Date()
            },
            create: {
              trackId: track.id,
              energy: finalEnergy,
              valence: finalValence,
              danceability: finalDanceability,
              tempo: finalTempo,
              source,
              confidence,
              tempoSource,
              tempoConfidence,
              lastUpdated: new Date()
            }
          });
          
          console.log(`[AudioFeatureEngine] Track "${track.title}" -> Energy: ${finalEnergy}, Mood: ${finalValence}, BPM: ${finalTempo}`);
        } else {
          // No provider had anything. We upsert an all-null marker so the
          // retry filter above re-picks this up after RETRY_AFTER_DAYS, and
          // clear the fields on update so a row that lost a previous match
          // is honestly described.
          await prisma.audioFeature.upsert({
            where: { trackId: track.id },
            update: {
              energy: null,
              valence: null,
              danceability: null,
              tempo: null,
              source: "not_found",
              confidence: 0,
              tempoSource: "not_found",
              tempoConfidence: 0,
              lastUpdated: new Date(),
            },
            create: {
              trackId: track.id,
              source: "not_found",
              confidence: 0,
              tempoSource: "not_found",
              tempoConfidence: 0,
              lastUpdated: new Date(),
            },
          });
          outcome = "not_found";
        }
      } catch (e: any) {
        if (isRateLimitError(e) || e.message === "NO_TOKEN") {
          // AudioDB or Deezer was rate-limited mid-track. Skip without
          // writing a marker row so the next batch can re-try once the
          // window has rolled off. This is what stops a hot AudioDB
          // rate-limit from silently downgrading every subsequent track
          // to a BPM-only row (and locking the audio features in for
          // 14 days even though the rate-limit was transient).
          outcome = "rate_limited";
          console.warn(
            `[AudioFeatureEngine] Rate-limited while looking up "${track.artist.title} - ${track.title}" (${e.message}); leaving it queued.`,
          );
        } else {
          console.error(`[AudioFeatureEngine] Unexpected error on track ${track.title}:`, e.message);
          outcome = "error";
        }
      } finally {
        endTimer();
        trackAttemptsTotal.inc({ engine: ENGINE, result: outcome });
      }

      if (providerDelayMs > 0) {
        await sleep(providerDelayMs);
      }
    }

    console.log(`[AudioFeatureEngine] Audio features sync batch completed! (${attempted} attempted)`);

  } catch (error) {
    console.error("[AudioFeatureEngine] Sync failed", error);
  }

  return attempted;
};
