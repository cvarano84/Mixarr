import prisma from "./prisma";
import { getDeezerPopularity } from "./providers/deezer";
import { getLastFmPopularity } from "./providers/lastfm";
import { isRateLimitError } from "./providers/rateLimit";
import { getSpotifyPopularity } from "./providers/spotify";
import { resolveDelayMs, resolveLimit, type SyncEngineOptions } from "./syncSettings";
import {
  engineBatchSize,
  trackAttemptsTotal,
  trackDurationSeconds,
} from "./metrics";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const ENGINE = "popularity";

// How long we wait before retrying a track that previously failed to enrich.
// We store the failure as a "not_found" row, and re-attempt anything older
// than this so transient outages don't burn a track in permanently.
const RETRY_AFTER_DAYS = 14;
const RETRY_MS = RETRY_AFTER_DAYS * 24 * 60 * 60 * 1000;

// One batch of popularity enrichment. Returns the number of tracks we
// attempted, which the scheduler uses to know when the queue is drained.
export const runPopularityEngine = async (options: SyncEngineOptions = {}): Promise<number> => {
  console.log("[PopularityEngine] Starting background popularity sync...");

  let attempted = 0;

  try {
    const batchSize = resolveLimit(options.popularityBatchSize, "POPULARITY_BATCH_SIZE");
    const providerDelayMs = resolveDelayMs(options.providerDelayMs, 250);
    const retryThreshold = new Date(Date.now() - RETRY_MS);

    // Find tracks that have no popularity record OR were marked as
    // "not_found" more than RETRY_AFTER_DAYS ago.
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
      ...(batchSize ? { take: batchSize } : {}),
    });

    console.log(`[PopularityEngine] Found ${tracksToProcess.length} tracks needing popularity data.`);
    engineBatchSize.observe({ engine: ENGINE }, tracksToProcess.length);

    for (const track of tracksToProcess) {
      attempted += 1;
      let score: number | null = null;
      let provider = "none";
      let confidence = 0;
      let outcome: "success" | "not_found" | "rate_limited" | "error" = "success";
      const endTimer = trackDurationSeconds.startTimer({ engine: ENGINE });

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

        // If we found a score, save it
        if (score != null && !isNaN(score)) {
          await prisma.popularity.upsert({
            where: { trackId: track.id },
            update: {
              score,
              provider,
              confidence,
              matchedArtist: track.artist.title,
              matchedTitle: track.title,
              lastUpdated: new Date()
            },
            create: {
              trackId: track.id,
              score,
              provider,
              confidence,
              matchedArtist: track.artist.title,
              matchedTitle: track.title,
              lastUpdated: new Date()
            }
          });
          
          console.log(`[PopularityEngine] Track "${track.title}" -> ${score} (${provider})`);
        } else {
          // No provider returned anything. Upsert a "not_found" marker so
          // we skip this track until the retry window elapses (instead of
          // burning it in permanently). Clearing matchedArtist/matchedTitle
          // on update keeps a previously-real-then-lost-match row honest.
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
          outcome = "not_found";
        }
      } catch (e: any) {
        if (isRateLimitError(e) || e.message === "NO_TOKEN") {
          // A provider was rate-limited (any provider — Deezer, Last.fm,
          // Spotify). Do NOT save a not_found marker; leave the track
          // queued so the next batch re-tries against the preferred
          // provider once its rate-limit window has rolled off. This is
          // what stops a hot Deezer rate-limit from silently downgrading
          // the entire batch to Last.fm or Spotify and locking those
          // tracks into the worse data for 14 days.
          outcome = "rate_limited";
          console.warn(
            `[PopularityEngine] Rate-limited while looking up "${track.artist.title} - ${track.title}" (${e.message}); leaving it queued.`,
          );
        } else {
          console.error(`[PopularityEngine] Unexpected error on track ${track.title}:`, e.message);
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

    console.log(`[PopularityEngine] Popularity sync batch completed! (${attempted} attempted)`);

  } catch (error) {
    console.error("[PopularityEngine] Sync failed", error);
  }

  return attempted;
};
