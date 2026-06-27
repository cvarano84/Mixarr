import prisma from "./prisma";
import { resolveTrackGenreTags } from "./trackTagProviders";
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

const ENGINE = "tags";

// How long we wait before retrying a track that previously failed to enrich.
// tagsSyncedAt is bumped on every attempt, so we re-pick anything older than
// this that still has no genre tag attached.
const RETRY_AFTER_DAYS = 14;
const RETRY_MS = RETRY_AFTER_DAYS * 24 * 60 * 60 * 1000;

// One batch of track-tag enrichment. The scheduler uses attempted=0
// to know when the queue is drained.
export const runTrackTagEngine = async (options: SyncEngineOptions = {}): Promise<EnrichmentRunSummary> => {
  console.log("[TrackTagEngine] Starting background track tag sync...");

  let summary: EnrichmentRunSummary = { attempted: 0, processed: 0, skipped: 0, failed: 0 };

  try {
    const batchSize = resolveLimit(options.tagBatchSize, "TRACK_TAG_BATCH_SIZE");
    const providerDelayMs = resolveDelayMs(options.providerDelayMs, 250);
    const rateLimitBackoffEnabled = resolveRateLimitBackoff(options.rateLimitBackoffEnabled);
    const retryThreshold = new Date(Date.now() - RETRY_MS);
    const where = {
      syncStatus: "active",
      OR: [
        { tagsSyncedAt: null },
        {
          AND: [
            { tagsSyncedAt: { lt: retryThreshold } },
            { tags: { none: { type: "genre" } } },
          ],
        },
      ],
    };
    const candidateCount = await prisma.track.count({ where });
    console.log(`[TrackTagEngine] Found ${candidateCount} tracks needing tags.`);
    engineBatchSize.observe({ engine: ENGINE }, Math.min(candidateCount, batchSize || candidateCount));

    summary = await safeTrackBatchIterator<any>({
      engineName: "TrackTagEngine",
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
      const attemptedAt = new Date();
      try {
        let shouldMarkSynced = true;
        const tagResolution = await resolveTrackGenreTags(
          track.artist.title,
          track.title,
          rateLimitBackoffEnabled,
        );
        const tags = tagResolution.tags;

        if (tags.length > 0) {
          let connectedTags = 0;
          // Connect or create each tag and link to the track
          for (const tagName of tags) {
            const cleanTag = sanitizeRequiredMetadataString(tagName, { entity: "Track", entityId: track.id, field: "genre" }).toLowerCase().trim();
            if (cleanTag.length < 2) continue;

            const tagRecord = await prisma.tag.upsert({
              where: { type_name: { type: "genre", name: cleanTag } },
              update: {},
              create: { type: "genre", name: cleanTag },
            });

            // Link to track
            await prisma.track.update({
              where: { id: track.id },
              data: {
                tags: {
                  connect: { id: tagRecord.id }
                }
              },
              select: { id: true },
            });
            connectedTags += 1;
          }
          if (connectedTags > 0) {
            console.log(`[TrackTagEngine] Track "${track.title}" -> Tags: ${tags.join(", ")} (${tagResolution.provider})`);
          } else {
            outcome = "not_found";
          }
        } else if (tagResolution.rateLimited) {
          outcome = "rate_limited";
          shouldMarkSynced = false;
          console.warn(
            `[TrackTagEngine] Rate limited while looking up "${track.artist.title} - ${track.title}"; leaving it queued.`,
          );
        } else {
          // No tags returned. We still bump tagsSyncedAt below, and the
          // retry filter above will re-pick this up after RETRY_AFTER_DAYS
          // if it still has no genre tags.
          outcome = "not_found";
          if (tagResolution.attemptedProviders.length === 0) {
            console.warn("[TrackTagEngine] No track tag providers are configured.");
          }
        }

        // Mark track as synced
        if (shouldMarkSynced) {
          await prisma.track.update({
            where: { id: track.id },
            data: {
              tagsSyncedAt: attemptedAt,
              genreStatus: outcome === "not_found" ? "no_data" : "success",
              genreAttemptedAt: attemptedAt,
              genreFailureReason: null,
            },
            select: { id: true },
          });
        } else {
          await prisma.track.update({
            where: { id: track.id },
            data: {
              genreStatus: "pending",
              genreAttemptedAt: attemptedAt,
              genreFailureReason: null,
            },
            select: { id: true },
          });
        }

      } catch (e: any) {
        console.error(`[TrackTagEngine] Unexpected error on track ${track.title}:`, e.message);
        outcome = "error";
        await prisma.track.update({
          where: { id: track.id },
          data: {
            genreStatus: "failed",
            genreAttemptedAt: attemptedAt,
            genreFailureReason: String(e?.message || e || "Track genre lookup failed").slice(0, 1_000),
          },
          select: { id: true },
        });
      } finally {
        endTimer();
        trackAttemptsTotal.inc({ engine: ENGINE, result: outcome });
      }

        if (providerDelayMs > 0) await sleep(providerDelayMs);
        return outcome === "error" ? "failed" : "processed";
      },
    });

    console.log(`[TrackTagEngine] Track tag sync batch completed! (${summary.attempted} attempted, ${summary.skipped} skipped, ${summary.failed} failed)`);

  } catch (error) {
    console.error("[TrackTagEngine] Sync failed", error);
  }

  return summary;
};
