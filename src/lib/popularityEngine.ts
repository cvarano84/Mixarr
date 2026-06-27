import prisma from "./prisma";
import { getDeezerPopularity } from "./providers/deezer";
import { getLastFmPopularity } from "./providers/lastfm";
import { isRateLimitError } from "./providers/rateLimit";
import { getSpotifyPopularity } from "./providers/spotify";
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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const ENGINE = "popularity";

// How long we wait before retrying a track that previously failed to enrich.
// We store the failure as a "not_found" row, and re-attempt anything older
// than this so transient outages don't burn a track in permanently.
const RETRY_AFTER_DAYS = 14;
const RETRY_MS = RETRY_AFTER_DAYS * 24 * 60 * 60 * 1000;

type PopularityMatch = {
  confidence: number;
  provider: "deezer" | "lastfm" | "spotify";
  score: number;
};

const popularityProviders = [
  {
    provider: "deezer",
    confidence: 0.75,
    lookup: getDeezerPopularity,
  },
  {
    provider: "lastfm",
    confidence: 0.7,
    lookup: getLastFmPopularity,
  },
  {
    provider: "spotify",
    confidence: 0.8,
    lookup: getSpotifyPopularity,
  },
] as const;

async function resolvePopularity(
  artist: string,
  track: string,
  rateLimitBackoffEnabled: boolean,
) {
  let rateLimited = false;

  for (const candidate of popularityProviders) {
    try {
      const score = await candidate.lookup(artist, track);
      if (score != null && !isNaN(score)) {
        return {
          match: {
            confidence: candidate.confidence,
            provider: candidate.provider,
            score,
          } satisfies PopularityMatch,
          rateLimited,
        };
      }
    } catch (error) {
      if (!isRateLimitError(error) || rateLimitBackoffEnabled) {
        throw error;
      }

      rateLimited = true;
      console.warn(
        `[PopularityEngine] ${candidate.provider} rate-limited for "${artist} - ${track}"; trying the next provider.`,
      );
    }
  }

  return { match: null, rateLimited };
}

// One batch of popularity enrichment. The scheduler uses attempted=0
// to know when the queue is drained.
export const runPopularityEngine = async (options: SyncEngineOptions = {}): Promise<EnrichmentRunSummary> => {
  console.log("[PopularityEngine] Starting background popularity sync...");

  let summary: EnrichmentRunSummary = { attempted: 0, processed: 0, skipped: 0, failed: 0 };

  try {
    const batchSize = resolveLimit(options.popularityBatchSize, "POPULARITY_BATCH_SIZE");
    const providerDelayMs = resolveDelayMs(options.providerDelayMs, 250);
    const rateLimitBackoffEnabled = resolveRateLimitBackoff(options.rateLimitBackoffEnabled);
    const retryThreshold = new Date(Date.now() - RETRY_MS);

    // Find tracks that have no popularity record OR were marked as
    // "not_found" more than RETRY_AFTER_DAYS ago.
    const where = {
      syncStatus: "active",
      OR: [
        { popularity: null },
        {
          popularity: {
            provider: "not_found",
            lastUpdated: { lt: retryThreshold },
          },
        },
      ],
    };
    const candidateCount = await prisma.track.count({ where });
    console.log(`[PopularityEngine] Found ${candidateCount} tracks needing popularity data.`);
    engineBatchSize.observe({ engine: ENGINE }, Math.min(candidateCount, batchSize || candidateCount));

    summary = await safeTrackBatchIterator<any>({
      engineName: "PopularityEngine",
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
      let score: number | null = null;
      let provider = "none";
      let confidence = 0;
      let outcome: "success" | "not_found" | "rate_limited" | "error" = "success";
      const endTimer = trackDurationSeconds.startTimer({ engine: ENGINE });
      const attemptedAt = new Date();

      try {
        const popularity = await resolvePopularity(
          track.artist.title,
          track.title,
          rateLimitBackoffEnabled,
        );

        if (popularity.match) {
          score = popularity.match.score;
          provider = popularity.match.provider;
          confidence = popularity.match.confidence;
        }

        // If we found a score, save it
        if (score != null && !isNaN(score)) {
          await prisma.popularity.upsert({
            where: { trackId: track.id },
            update: {
              score,
              provider,
              confidence,
              matchedArtist: sanitizeRequiredMetadataString(track.artist.title),
              matchedTitle: sanitizeRequiredMetadataString(track.title),
              lastUpdated: attemptedAt
            },
            create: {
              trackId: track.id,
              score,
              provider,
              confidence,
              matchedArtist: sanitizeRequiredMetadataString(track.artist.title),
              matchedTitle: sanitizeRequiredMetadataString(track.title),
              lastUpdated: attemptedAt
            }
          });
          await prisma.track.update({
            where: { id: track.id },
            data: {
              popularityStatus: "success",
              popularityAttemptedAt: attemptedAt,
              popularityFailureReason: null,
            },
            select: { id: true },
          });
          
          console.log(`[PopularityEngine] Track "${track.title}" -> ${score} (${provider})`);
        } else if (popularity.rateLimited) {
          outcome = "rate_limited";
          await prisma.track.update({
            where: { id: track.id },
            data: {
              popularityStatus: "pending",
              popularityAttemptedAt: attemptedAt,
              popularityFailureReason: null,
            },
            select: { id: true },
          });
          console.warn(
            `[PopularityEngine] Rate-limited providers had no fallback result for "${track.artist.title} - ${track.title}"; leaving it queued.`,
          );
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
              lastUpdated: attemptedAt,
            },
            create: {
              trackId: track.id,
              score: 0,
              provider: "not_found",
              confidence: 0,
              lastUpdated: attemptedAt,
            },
          });
          await prisma.track.update({
            where: { id: track.id },
            data: {
              popularityStatus: "no_data",
              popularityAttemptedAt: attemptedAt,
              popularityFailureReason: null,
            },
            select: { id: true },
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
          await prisma.track.update({
            where: { id: track.id },
            data: {
              popularityStatus: "pending",
              popularityAttemptedAt: attemptedAt,
              popularityFailureReason: null,
            },
            select: { id: true },
          });
          console.warn(
            `[PopularityEngine] Rate-limited while looking up "${track.artist.title} - ${track.title}" (${e.message}); leaving it queued.`,
          );
        } else {
          console.error(`[PopularityEngine] Unexpected error on track ${track.title}:`, e.message);
          outcome = "error";
          await prisma.track.update({
            where: { id: track.id },
            data: {
              popularityStatus: "failed",
              popularityAttemptedAt: attemptedAt,
              popularityFailureReason: String(e?.message || e || "Popularity lookup failed").slice(0, 1_000),
            },
            select: { id: true },
          });
        }
      } finally {
        endTimer();
        trackAttemptsTotal.inc({ engine: ENGINE, result: outcome });
      }

        if (providerDelayMs > 0) await sleep(providerDelayMs);
        return outcome === "error" ? "failed" : "processed";
      },
    });

    console.log(`[PopularityEngine] Popularity sync batch completed! (${summary.attempted} attempted, ${summary.skipped} skipped, ${summary.failed} failed)`);

  } catch (error) {
    console.error("[PopularityEngine] Sync failed", error);
  }

  return summary;
};
