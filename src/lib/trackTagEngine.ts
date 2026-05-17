import prisma from "./prisma";
import { resolveTrackGenreTags } from "./trackTagProviders";
import { resolveDelayMs, resolveLimit, type SyncEngineOptions } from "./syncSettings";
import {
  engineBatchSize,
  trackAttemptsTotal,
  trackDurationSeconds,
} from "./metrics";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const ENGINE = "tags";

// How long we wait before retrying a track that previously failed to enrich.
// tagsSyncedAt is bumped on every attempt, so we re-pick anything older than
// this that still has no genre tag attached.
const RETRY_AFTER_DAYS = 14;
const RETRY_MS = RETRY_AFTER_DAYS * 24 * 60 * 60 * 1000;

// One batch of track-tag enrichment. Returns the number of tracks we
// attempted, which the scheduler uses to know when the queue is drained.
export const runTrackTagEngine = async (options: SyncEngineOptions = {}): Promise<number> => {
  console.log("[TrackTagEngine] Starting background track tag sync...");

  let attempted = 0;

  try {
    const batchSize = resolveLimit(options.tagBatchSize, "TRACK_TAG_BATCH_SIZE");
    const providerDelayMs = resolveDelayMs(options.providerDelayMs, 250);
    const retryThreshold = new Date(Date.now() - RETRY_MS);
    const tracksToProcess = await prisma.track.findMany({
      where: {
        OR: [
          // Never attempted
          { tagsSyncedAt: null },
          // Previously attempted, still has no genre tags, retry window elapsed
          {
            AND: [
              { tagsSyncedAt: { lt: retryThreshold } },
              { tags: { none: { type: "genre" } } },
            ],
          },
        ],
      },
      include: { artist: true },
      ...(batchSize ? { take: batchSize } : {}),
    });

    console.log(`[TrackTagEngine] Found ${tracksToProcess.length} tracks needing tags.`);
    engineBatchSize.observe({ engine: ENGINE }, tracksToProcess.length);

    for (const track of tracksToProcess) {
      attempted += 1;
      let outcome: "success" | "not_found" | "rate_limited" | "error" = "success";
      const endTimer = trackDurationSeconds.startTimer({ engine: ENGINE });
      try {
        let shouldMarkSynced = true;
        const tagResolution = await resolveTrackGenreTags(track.artist.title, track.title);
        const tags = tagResolution.tags;

        if (tags.length > 0) {
          // Connect or create each tag and link to the track
          for (const tagName of tags) {
            const cleanTag = tagName.toLowerCase().trim();
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
              }
            });
          }
          console.log(`[TrackTagEngine] Track "${track.title}" -> Tags: ${tags.join(", ")} (${tagResolution.provider})`);
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
            data: { tagsSyncedAt: new Date() }
          });
        }

      } catch (e: any) {
        console.error(`[TrackTagEngine] Unexpected error on track ${track.title}:`, e.message);
        outcome = "error";
      } finally {
        endTimer();
        trackAttemptsTotal.inc({ engine: ENGINE, result: outcome });
      }

      if (providerDelayMs > 0) {
        await sleep(providerDelayMs);
      }
    }

    console.log(`[TrackTagEngine] Track tag sync batch completed! (${attempted} attempted)`);

  } catch (error) {
    console.error("[TrackTagEngine] Sync failed", error);
  }

  return attempted;
};
