import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import {
  buildMetadataTrackWhere,
  buildMissingTrackWhere,
  isGenreHealthFilter,
  isMetadataHealthSection,
  isPopularityHealthFilter,
  metadataHealthTrackSelect,
  metadataTracksToCsv,
  missingTrackSelect,
  serializeMetadataHealthTrack,
  serializeMissingTrack,
  toCsv,
} from "@/lib/libraryHealth";
import type { MetadataHealthFilter } from "@/lib/libraryHealth";

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
  const format = params.get("format") === "json" ? "json" : "csv";
  const section = params.get("section");
  const filter = params.get("filter");

  if (isMetadataHealthSection(section)) {
    const validFilter = section === "genres" ? isGenreHealthFilter(filter) : isPopularityHealthFilter(filter);
    if (!validFilter) return NextResponse.json({ error: "A valid metadata health filter is required" }, { status: 400 });
    const metadataFilter = filter as MetadataHealthFilter;

    const where = buildMetadataTrackWhere(userId, {
      section,
      filter: metadataFilter,
      libraryId: params.get("libraryId") || undefined,
      search: params.get("search")?.trim() || undefined,
    });

    try {
      const rows = await prisma.track.findMany({
        where,
        select: metadataHealthTrackSelect,
        orderBy: [{ artist: { title: "asc" } }, { album: { title: "asc" } }, { title: "asc" }],
      });
      const serialized = rows.map(serializeMetadataHealthTrack);
      console.log(`[LibraryHealth] Exported ${section} ${metadataFilter}: ${serialized.length} tracks`);
      const headers = {
        "Content-Disposition": `attachment; filename="mixarr-${section}-${metadataFilter}.${format}"`,
        "Cache-Control": "no-store",
      };
      if (format === "json") {
        return new NextResponse(JSON.stringify(serialized, null, 2), {
          headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
        });
      }
      return new NextResponse(metadataTracksToCsv(serialized), {
        headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
      });
    } catch (error) {
      console.error("[LibraryHealth] Failed to export metadata tracks", error);
      return NextResponse.json({ error: "Failed to export metadata tracks" }, { status: 500 });
    }
  }

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
    const rows = await prisma.track.findMany({ where, select: missingTrackSelect, orderBy: { missingSince: "desc" } });
    const libraryCounts = new Map<string, { name: string; count: number }>();
    rows.forEach((row) => {
      const current = libraryCounts.get(row.library.id) || { name: row.library.name, count: 0 };
      current.count += 1;
      libraryCounts.set(row.library.id, current);
    });
    libraryCounts.forEach(({ name, count }) => console.log(`[LibraryHealth] Exported missing tracks for ${name}: ${count}`));

    const headers = {
      "Content-Disposition": `attachment; filename="mixarr-missing-tracks.${format}"`,
      "Cache-Control": "no-store",
    };
    if (format === "json") {
      return new NextResponse(JSON.stringify(rows.map(serializeMissingTrack), null, 2), {
        headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
      });
    }
    return new NextResponse(toCsv(rows), {
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
    });
  } catch (error) {
    console.error("[LibraryHealth] Failed to export missing tracks", error);
    return NextResponse.json({ error: "Failed to export missing tracks" }, { status: 500 });
  }
}
