import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import {
  buildMetadataTrackWhere,
  getMetadataHealthSummary,
  isGenreHealthFilter,
  isMetadataHealthSection,
  isPopularityHealthFilter,
  MAX_METADATA_PAGE_SIZE,
  metadataHealthTrackSelect,
  serializeMetadataHealthTrack,
} from "@/lib/libraryHealth";
import type { MetadataHealthFilter } from "@/lib/libraryHealth";

export const dynamic = "force-dynamic";

function validSectionFilter(section: string | null, filter: string | null) {
  if (section === "genres") return isGenreHealthFilter(filter);
  if (section === "popularity") return isPopularityHealthFilter(filter);
  return false;
}

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const section = params.get("section");
  const filter = params.get("filter");
  if (!isMetadataHealthSection(section) || !validSectionFilter(section, filter)) {
    return NextResponse.json({ error: "A valid metadata health section and filter are required" }, { status: 400 });
  }
  const metadataFilter = filter as MetadataHealthFilter;

  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.min(MAX_METADATA_PAGE_SIZE, Math.max(1, Number(params.get("pageSize")) || 50));
  const libraryId = params.get("libraryId") || undefined;
  const where = buildMetadataTrackWhere(userId, {
    section,
    filter: metadataFilter,
    libraryId,
    search: params.get("search")?.trim() || undefined,
  });

  try {
    const [tracks, total, summary] = await Promise.all([
      prisma.track.findMany({
        where,
        select: metadataHealthTrackSelect,
        orderBy: [{ artist: { title: "asc" } }, { album: { title: "asc" } }, { title: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.track.count({ where }),
      getMetadataHealthSummary(userId, section, libraryId),
    ]);

    return NextResponse.json({
      tracks: tracks.map(serializeMetadataHealthTrack),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      section,
      filter: metadataFilter,
      summary,
    });
  } catch (error) {
    console.error("[LibraryHealth] Failed to load metadata tracks", error);
    return NextResponse.json({ error: "Failed to load metadata tracks" }, { status: 500 });
  }
}
