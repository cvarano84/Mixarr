import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import {
  buildMissingTrackWhere,
  MAX_MISSING_PAGE_SIZE,
  missingTrackSelect,
  serializeMissingTrack,
} from "@/lib/libraryHealth";

export const dynamic = "force-dynamic";

function validDate(value: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.min(MAX_MISSING_PAGE_SIZE, Math.max(1, Number(params.get("pageSize")) || 25));
  const where = buildMissingTrackWhere(userId, {
    libraryId: params.get("libraryId") || undefined,
    artist: params.get("artist")?.trim() || undefined,
    album: params.get("album")?.trim() || undefined,
    search: params.get("search")?.trim() || undefined,
    bpmStatus: params.get("bpmStatus") || undefined,
    missingSinceFrom: validDate(params.get("missingSinceFrom")),
    missingSinceBefore: validDate(params.get("missingSinceBefore")),
  });

  try {
    const [tracks, total] = await Promise.all([
      prisma.track.findMany({
        where,
        select: missingTrackSelect,
        orderBy: [{ missingSince: "desc" }, { title: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.track.count({ where }),
    ]);
    return NextResponse.json({
      tracks: tracks.map(serializeMissingTrack),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    });
  } catch (error) {
    console.error("[LibraryHealth] Failed to load missing tracks", error);
    return NextResponse.json({ error: "Failed to load missing tracks" }, { status: 500 });
  }
}
