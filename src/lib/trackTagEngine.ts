import prisma from "./prisma";
import { getLastFmTrackTags } from "./providers/lastfm";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// See popularityEngine.ts for context on these knobs.
const BATCH_SIZE = 2000;
const RETRY_AFTER_DAYS = 14;
const RETRY_MS = RETRY_AFTER_DAYS * 24 * 60 * 60 * 1000;

/**
 * Process one batch of tracks needing genre tags.
 * Returns the number of tracks actually attempted. The scheduler loops this
 * until it returns 0.
 */
export const runTrackTagEngine = async (): Promise<number> => {
  console.log("[TrackTagEngine] Starting background track tag sync batch...");

  let attempted = 0;

  try {
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
      take: BATCH_SIZE,
    });

    console.log(`[TrackTagEngine] Found ${tracksToProcess.length} tracks needing tags.`);

    for (const track of tracksToProcess) {
      attempted += 1;
      try {
        const tags = await getLastFmTrackTags(track.artist.title, track.title);

        if (tags.length > 0) {
          for (const tagName of tags) {
            const cleanTag = tagName.toLowerCase().trim();
            if (cleanTag.length < 2) continue;

            const tagRecord = await prisma.tag.upsert({
              where: { type_name: { type: "genre", name: cleanTag } },
              update: {},
              create: { type: "genre", name: cleanTag },
            });

            await prisma.track.update({
              where: { id: track.id },
              data: { tags: { connect: { id: tagRecord.id } } },
            });
          }
          console.log(`[TrackTagEngine] Track "${track.title}" -> Tags: ${tags.join(", ")}`);
        } else {
          console.log(`[TrackTagEngine] Track "${track.title}" -> no tags (retry in ${RETRY_AFTER_DAYS}d)`);
        }

        // Mark as attempted regardless of success; the filter above will
        // re-pick it up after RETRY_AFTER_DAYS if it still has no tags.
        await prisma.track.update({
          where: { id: track.id },
          data: { tagsSyncedAt: new Date() },
        });
      } catch (e: any) {
        console.error(`[TrackTagEngine] Unexpected error on track ${track.title}:`, e.message);
      }

      // Respect Last.fm API rate limits (5/sec allowed, we'll do 4/sec).
      await sleep(250);
    }

    console.log(`[TrackTagEngine] Track tag sync batch completed! (${attempted} attempted)`);
  } catch (error) {
    console.error("[TrackTagEngine] Sync failed", error);
  }

  return attempted;
};
