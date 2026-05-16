import prisma from "./prisma";
import { getAudioDbFeatures } from "./providers/audiodb";
import { getDeezerBpm } from "./providers/deezer";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// See popularityEngine.ts for context on these knobs.
const BATCH_SIZE = 2000;
const RETRY_AFTER_DAYS = 14;
const RETRY_MS = RETRY_AFTER_DAYS * 24 * 60 * 60 * 1000;

/**
 * Process one batch of tracks needing audio features.
 * Returns the number of tracks actually attempted. The scheduler loops this
 * until it returns 0.
 */
export const runAudioFeatureEngine = async (): Promise<number> => {
  console.log("[AudioFeatureEngine] Starting background audio features sync batch...");

  let attempted = 0;

  try {
    const retryThreshold = new Date(Date.now() - RETRY_MS);

    const tracksToProcess = await prisma.track.findMany({
      where: {
        OR: [
          // Never attempted
          { audioFeature: null },
          // Previously attempted but all enrichment fields are null
          // (the "no provider had anything" marker), and the retry window
          // has elapsed.
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
      take: BATCH_SIZE,
    });

    console.log(`[AudioFeatureEngine] Found ${tracksToProcess.length} tracks needing audio features.`);

    for (const track of tracksToProcess) {
      attempted += 1;
      try {
        // 1. AudioDB for mood -> energy/valence
        let features = await getAudioDbFeatures(track.artist.title, track.title);

        // 2. Deezer for accurate BPM
        let bpm = await getDeezerBpm(track.artist.title, track.title);

        if (features || bpm) {
          // Got something from at least one provider. Merge what we have.
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
              lastUpdated: new Date(),
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
              lastUpdated: new Date(),
            },
          });

          console.log(`[AudioFeatureEngine] Track "${track.title}" -> Energy: ${finalEnergy}, Mood: ${finalValence}, BPM: ${finalTempo}`);
        } else {
          // No provider had anything. Upsert an all-null row so we skip this
          // track until the retry window elapses, but allow eventual retry
          // (the old code never retried these). The retry filter above keys
          // off the four enrichment columns being null, so we leave those
          // null and use upstream's `source`/`tempoSource = "not_found"`
          // marker columns to make the no-data state self-describing.
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
          console.log(`[AudioFeatureEngine] Track "${track.title}" -> no data (retry in ${RETRY_AFTER_DAYS}d)`);
        }
      } catch (e: any) {
        if (e.message === "NO_TOKEN" || e.message?.startsWith("RATE_LIMIT")) {
          // Skip without writing a marker so this track is retried next batch.
          console.log(`[AudioFeatureEngine] Track "${track.title}" -> skipped (${e.message})`);
        } else {
          console.error(`[AudioFeatureEngine] Unexpected error on track ${track.title}:`, e.message);
        }
      }

      // Respect API rate limits.
      await sleep(250);
    }

    console.log(`[AudioFeatureEngine] Audio features sync batch completed! (${attempted} attempted)`);
  } catch (error) {
    console.error("[AudioFeatureEngine] Sync failed", error);
  }

  return attempted;
};
