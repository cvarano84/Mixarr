import prisma from "./prisma";
import { getDeezerPopularity } from "./providers/deezer";
import { getLastFmPopularity } from "./providers/lastfm";
import { getSpotifyPopularity } from "./providers/spotify";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Batch size per invocation. The scheduler calls this engine in a loop until
// it returns 0, so this is now just a memory/checkpoint knob, not a cap on
// total throughput.
const BATCH_SIZE = 5000;

// How long to wait before retrying a track that previously failed to enrich.
// Stored as a "not_found" marker row in the Popularity table; rows older than
// this become eligible again so transient provider/network failures don't
// burn the track in permanently.
const RETRY_AFTER_DAYS = 14;
const RETRY_MS = RETRY_AFTER_DAYS * 24 * 60 * 60 * 1000;

/**
 * Process one batch of tracks needing popularity scores.
 * Returns the number of tracks the batch actually attempted (which may be 0
 * if there's no more work). The scheduler uses this to loop until drained.
 */
export const runPopularityEngine = async (): Promise<number> => {
  console.log("[PopularityEngine] Starting background popularity sync batch...");

  let attempted = 0;

  try {
    const retryThreshold = new Date(Date.now() - RETRY_MS);

    const tracksToProcess = await prisma.track.findMany({
      where: {
        OR: [
          // Never attempted
          { popularity: null },
          // Previously marked as "not_found" and the retry window has elapsed
          {
            popularity: {
              provider: "not_found",
              lastUpdated: { lt: retryThreshold },
            },
          },
        ],
      },
      include: { artist: true },
      take: BATCH_SIZE,
    });

    console.log(`[PopularityEngine] Found ${tracksToProcess.length} tracks needing popularity data.`);

    for (const track of tracksToProcess) {
      attempted += 1;
      let score: number | null = null;
      let provider = "none";
      let confidence = 0;

      try {
        // 1. Try Deezer (Primary)
        let dScore = await getDeezerPopularity(track.artist.title, track.title);
        if (dScore != null && !isNaN(dScore)) {
          score = dScore;
          provider = "deezer";
          confidence = 0.75;
        } else {
          // 2. Fallback to Last.fm
          let lScore = await getLastFmPopularity(track.artist.title, track.title);
          if (lScore != null && !isNaN(lScore)) {
            score = lScore;
            provider = "lastfm";
            confidence = 0.7;
          } else {
            // 3. Fallback to Spotify
            let sScore = await getSpotifyPopularity(track.artist.title, track.title);
            if (sScore != null && !isNaN(sScore)) {
              score = sScore;
              provider = "spotify";
              confidence = 0.8;
            }
          }
        }

        if (score != null && !isNaN(score)) {
          // Found a score: upsert with the real value
          await prisma.popularity.upsert({
            where: { trackId: track.id },
            update: {
              score,
              provider,
              confidence,
              matchedArtist: track.artist.title,
              matchedTitle: track.title,
              lastUpdated: new Date(),
            },
            create: {
              trackId: track.id,
              score,
              provider,
              confidence,
              matchedArtist: track.artist.title,
              matchedTitle: track.title,
              lastUpdated: new Date(),
            },
          });
          console.log(`[PopularityEngine] Track "${track.title}" -> ${score} (${provider})`);
        } else {
          // No provider returned anything. Upsert a "not_found" marker so
          // we skip this track until the retry window elapses, but do NOT
          // burn it in permanently the way the old code did. We still
          // clear the confidence/matched-* fields so a previously-real
          // row that's been re-evaluated and lost its match is described
          // honestly.
          await prisma.popularity.upsert({
            where: { trackId: track.id },
            update: {
              score: 0,
              provider: "not_found",
              confidence: 0,
              matchedArtist: null,
              matchedTitle: null,
              lastUpdated: new Date(),
            },
            create: {
              trackId: track.id,
              score: 0,
              provider: "not_found",
              confidence: 0,
              lastUpdated: new Date(),
            },
          });
          console.log(`[PopularityEngine] Track "${track.title}" -> no data (retry in ${RETRY_AFTER_DAYS}d)`);
        }
      } catch (e: any) {
        if (e.message === "NO_TOKEN" || e.message?.startsWith("RATE_LIMIT")) {
          // Rate limited / auth blocked. Do NOT save a marker row so this
          // track is retried on the next batch.
          console.log(`[PopularityEngine] Track "${track.title}" -> skipped (${e.message})`);
        } else {
          console.error(`[PopularityEngine] Unexpected error on track ${track.title}:`, e.message);
        }
      }

      // Respect API rate limits (Especially Last.fm's 5 req/sec).
      // 250ms = 4 requests per second.
      await sleep(250);
    }

    console.log(`[PopularityEngine] Popularity sync batch completed! (${attempted} attempted)`);
  } catch (error) {
    console.error("[PopularityEngine] Sync failed", error);
  }

  return attempted;
};
