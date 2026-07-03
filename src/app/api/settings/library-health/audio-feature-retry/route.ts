import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { audioFeatureRetryEligibilityTrackWhere } from "@/lib/audioFeatures";
import { audioFeatureHealthFilterWhere, isAudioFeatureHealthFilter } from "@/lib/libraryHealth";
import { getUserSyncSettings, resolveMetadataProviderSettings } from "@/lib/syncSettings";

const requestSchema = z.object({
  trackIds: z.array(z.string().uuid()).max(10_000).optional(),
  filter: z.string().optional(),
  libraryId: z.string().uuid().optional(),
  force: z.boolean().default(false),
  providerMode: z.enum(["configured", "api_only", "local_only", "force_local"]).default("configured"),
}).refine((body) => (body.trackIds?.length || 0) > 0 || !!body.filter, {
  message: "Provide trackIds or a filter",
});

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid retry request" }, { status: 400 });
    }
    const { trackIds, filter, libraryId, force, providerMode } = parsed.data;
    const syncSettings = resolveMetadataProviderSettings(await getUserSyncSettings(userId)).audioFeatures;
    if (!trackIds?.length && !isAudioFeatureHealthFilter(filter)) {
      return NextResponse.json({ error: "A valid audio-feature health filter is required" }, { status: 400 });
    }
    const targetWhere = trackIds?.length
      ? { id: { in: trackIds } }
      : isAudioFeatureHealthFilter(filter) ? audioFeatureHealthFilterWhere(filter) : { id: "__invalid__" };

    const targetScopedWhere = {
      AND: [
        {
          syncStatus: "active",
          library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } },
        },
        targetWhere,
      ],
    };
    const where = {
      AND: [
        {
          syncStatus: "active",
          library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } },
        },
        targetWhere,
        audioFeatureRetryEligibilityTrackWhere({
          force,
          providerMode,
          analysisScope: syncSettings.scope,
        }),
      ],
    };
    const originalCount = await prisma.track.count({ where: targetScopedWhere });
    const matching = await prisma.track.findMany({
      where,
      select: { id: true, title: true, artist: { select: { title: true } } },
    });
    const ids = matching.map((track) => track.id);
    const skippedAlreadyFixed = Math.max(0, originalCount - ids.length);

    for (let offset = 0; offset < ids.length; offset += 5_000) {
      const chunk = ids.slice(offset, offset + 5_000);
      await prisma.audioFeature.updateMany({
        where: { trackId: { in: chunk } },
        data: {
          audioFeatureStatus: "pending",
          audioFeatureFailureReason: null,
          audioFeatureAnalyzedAt: null,
        },
      });
    }
    revalidatePath("/settings/library-health");

    if (trackIds?.length && matching.length === 1) {
      console.log(`[LibraryHealth] Queued audio-feature retry for track: ${matching[0].artist.title} - ${matching[0].title}`);
    } else {
      console.log(`[LibraryHealth] Queued audio-feature retry for filter ${filter || "selected_tracks"}: ${matching.length} tracks (before=${originalCount}, skippedAlreadyFixed=${skippedAlreadyFixed})`);
    }
    return NextResponse.json({ queued: matching.length, trackIds: ids, providerMode, before: originalCount, skippedAlreadyFixed });
  } catch (error) {
    console.error("[LibraryHealth] Failed to queue audio-feature retry", error);
    return NextResponse.json({ error: "Failed to queue audio-feature retry" }, { status: 500 });
  }
}
