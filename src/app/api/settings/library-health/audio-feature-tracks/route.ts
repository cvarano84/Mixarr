import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import {
  audioFeatureHealthTrackSelect,
  buildAudioFeatureTrackWhere,
  getAudioFeatureHealthSummary,
  isAudioFeatureHealthFilter,
  MAX_AUDIO_FEATURE_PAGE_SIZE,
  serializeAudioFeatureHealthTrack,
} from "@/lib/libraryHealth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const filter = params.get("filter");
  if (!isAudioFeatureHealthFilter(filter)) {
    return NextResponse.json({ error: "A valid audio-feature health filter is required" }, { status: 400 });
  }

  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.min(MAX_AUDIO_FEATURE_PAGE_SIZE, Math.max(1, Number(params.get("pageSize")) || 50));
  const libraryId = params.get("libraryId") || undefined;
  const where = buildAudioFeatureTrackWhere(userId, {
    filter,
    libraryId,
    search: params.get("search")?.trim() || undefined,
  });

  try {
    const [tracks, total, summary] = await Promise.all([
      prisma.track.findMany({
        where,
        select: audioFeatureHealthTrackSelect,
        orderBy: [{ artist: { title: "asc" } }, { album: { title: "asc" } }, { title: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.track.count({ where }),
      getAudioFeatureHealthSummary(userId, libraryId),
    ]);

    return NextResponse.json({
      tracks: tracks.map(serializeAudioFeatureHealthTrack),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      filter,
      summary,
    });
  } catch (error) {
    console.error("[LibraryHealth] Failed to load audio-feature tracks", error);
    return NextResponse.json({ error: "Failed to load audio-feature tracks" }, { status: 500 });
  }
}
