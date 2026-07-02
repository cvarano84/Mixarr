import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { audioFeatureTooShortTrackWhere, missingAudioFeatureTrackWhere } from "@/lib/audioFeatures";
import { audioFeatureHealthFilterWhere, isAudioFeatureHealthFilter } from "@/lib/libraryHealth";

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
    if (!trackIds?.length && !isAudioFeatureHealthFilter(filter)) {
      return NextResponse.json({ error: "A valid audio-feature health filter is required" }, { status: 400 });
    }
    const targetWhere = trackIds?.length
      ? { id: { in: trackIds } }
      : isAudioFeatureHealthFilter(filter) ? audioFeatureHealthFilterWhere(filter) : { id: "__invalid__" };

    const where = {
      AND: [
        {
          syncStatus: "active",
          library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } },
        },
        targetWhere,
        ...(force || providerMode === "force_local" ? [] : [missingAudioFeatureTrackWhere()]),
        ...(force || providerMode === "force_local" ? [] : [{ NOT: audioFeatureTooShortTrackWhere() }]),
      ],
    };
    const matching = await prisma.track.findMany({
      where,
      select: { id: true, title: true, artist: { select: { title: true } } },
    });
    const ids = matching.map((track) => track.id);

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

    if (trackIds?.length && matching.length === 1) {
      console.log(`[LibraryHealth] Queued audio-feature retry for track: ${matching[0].artist.title} - ${matching[0].title}`);
    } else {
      console.log(`[LibraryHealth] Queued audio-feature retry for filter ${filter || "selected_tracks"}: ${matching.length} tracks`);
    }
    return NextResponse.json({ queued: matching.length, trackIds: ids, providerMode });
  } catch (error) {
    console.error("[LibraryHealth] Failed to queue audio-feature retry", error);
    return NextResponse.json({ error: "Failed to queue audio-feature retry" }, { status: 500 });
  }
}
