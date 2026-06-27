import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { fetchPlexItems } from "@/lib/syncEngine";
import { getUserSyncSettings } from "@/lib/syncSettings";
import { resolveLimit } from "@/lib/syncSettings";

const bodySchema = z.object({
  libraryId: z.string().min(1),
  trackIds: z.array(z.string().min(1)).max(1000).optional(),
});

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const library = await prisma.library.findFirst({
    where: { id: parsed.data.libraryId, server: { userId } },
    include: { server: true },
  });
  if (!library) return NextResponse.json({ error: "Library not found" }, { status: 404 });

  try {
    const settings = await getUserSyncSettings(userId);
    const pageSize = resolveLimit(settings.plexPageSize, "PLEX_METADATA_PAGE_SIZE");
    const { items } = await fetchPlexItems(library.server.uri, library.server.accessToken, library.plexId, 10, pageSize);
    const plexIds = new Set(items.map((item) => String(item.ratingKey)));
    const candidates = await prisma.track.findMany({
      where: {
        libraryId: library.id,
        syncStatus: "missing",
        ...(parsed.data.trackIds?.length ? { id: { in: parsed.data.trackIds } } : {}),
      },
      select: { id: true, plexId: true, albumId: true, artistId: true },
    });
    const found = candidates.filter((track) => plexIds.has(track.plexId));
    const now = new Date();
    if (found.length) {
      await prisma.$transaction([
        prisma.track.updateMany({
          where: { id: { in: found.map((track) => track.id) }, libraryId: library.id, syncStatus: "missing" },
          data: { syncStatus: "active", lastSeenAt: now, missingSince: null, deletedAt: null },
        }),
        prisma.album.updateMany({
          where: { id: { in: found.map((track) => track.albumId) }, libraryId: library.id },
          data: { syncStatus: "active", lastSeenAt: now, missingSince: null, deletedAt: null },
        }),
        prisma.artist.updateMany({
          where: { id: { in: found.map((track) => track.artistId) }, libraryId: library.id },
          data: { syncStatus: "active", lastSeenAt: now, missingSince: null, deletedAt: null },
        }),
      ]);
    }
    const stillMissing = candidates.length - found.length;
    console.log(`[LibraryHealth] Checked missing tracks against Plex: restored ${found.length}, still missing ${stillMissing}`);
    return NextResponse.json({ checked: candidates.length, restored: found.length, stillMissing });
  } catch (error) {
    console.error("[LibraryHealth] Missing track check failed", error);
    return NextResponse.json({ error: "Plex check failed; no track statuses were changed" }, { status: 502 });
  }
}
