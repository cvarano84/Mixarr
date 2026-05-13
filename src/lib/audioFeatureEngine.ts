import prisma from "./prisma";
import { getSpotifyAudioFeatures } from "./providers/spotify";
import { getAudioDbFeatures } from "./providers/audiodb";
import { getDeezerBpm } from "./providers/deezer";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const runAudioFeatureEngine = async () => {
  console.log("[AudioFeatureEngine] Starting background audio features sync...");

  try {
    const tracksToProcess = await prisma.track.findMany({
      where: { audioFeature: null },
      include: { artist: true },
      take: 2000, 
    });

    console.log(`[AudioFeatureEngine] Found ${tracksToProcess.length} tracks needing audio features.`);

    for (const track of tracksToProcess) {
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

          await prisma.audioFeature.upsert({
            where: { trackId: track.id },
            update: {
              energy: finalEnergy,
              valence: finalValence,
              danceability: finalDanceability,
              tempo: finalTempo,
              lastUpdated: new Date()
            },
            create: {
              trackId: track.id,
              energy: finalEnergy,
              valence: finalValence,
              danceability: finalDanceability,
              tempo: finalTempo,
              lastUpdated: new Date()
            }
          });
          
          console.log(`[AudioFeatureEngine] Track "${track.title}" -> Energy: ${finalEnergy}, Mood: ${finalValence}, BPM: ${finalTempo}`);
        } else {
          // Mark as empty to avoid infinite retries
          await prisma.audioFeature.create({
            data: {
              trackId: track.id,
              lastUpdated: new Date()
            }
          });
        }
      } catch (e: any) {
        if (e.message === "NO_TOKEN" || e.message?.startsWith("RATE_LIMIT")) {
          // Do not log the full stack trace for known auth/rate limits, just skip
        } else {
          console.error(`[AudioFeatureEngine] Unexpected error on track ${track.title}:`, e.message);
        }
      }

      // Respect API rate limits (AudioDB free tier is very generous, we'll do 4/sec)
      await sleep(250);
    }

    console.log("[AudioFeatureEngine] Audio features sync batch completed!");

  } catch (error) {
    console.error("[AudioFeatureEngine] Sync failed", error);
  }
};
