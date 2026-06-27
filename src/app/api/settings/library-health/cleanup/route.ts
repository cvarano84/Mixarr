import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { DEFAULT_CLEANUP_DAYS } from "@/lib/libraryHealth";

const cleanupSchema = z.object({
  libraryId: z.string().min(1).optional(),
  trackIds: z.array(z.string().min(1)).max(5000).optional(),
  days: z.coerce.number().int().min(1).max(36500).optional(),
  dryRun: z.boolean().optional(),
  confirm: z.boolean().optional(),
}).refine((body) => Boolean(body.trackIds?.length || body.days), "Track IDs or an age threshold is required");

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = cleanupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid cleanup request" }, { status: 400 });
  const { libraryId, trackIds, dryRun, confirm } = parsed.data;
  const days = parsed.data.days || DEFAULT_CLEANUP_DAYS;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const where = {
    syncStatus: "missing",
    library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } },
    ...(trackIds?.length ? { id: { in: trackIds } } : { missingSince: { lte: cutoff } }),
  } as const;

  const targets = await prisma.track.findMany({ where, select: { id: true, libraryId: true } });
  if (dryRun) return NextResponse.json({ count: targets.length, days, cutoff });
  if (!confirm) return NextResponse.json({ error: "Explicit confirmation is required" }, { status: 400 });
  if (!targets.length) return NextResponse.json({ deleted: 0, days });

  const ids = targets.map((track) => track.id);
  const libraryIds = Array.from(new Set(targets.map((track) => track.libraryId)));
  const result = await prisma.$transaction(async (tx) => {
    const deleted = await tx.track.deleteMany({ where: { id: { in: ids }, syncStatus: "missing" } });
    await tx.album.deleteMany({
      where: { libraryId: { in: libraryIds }, syncStatus: "missing", tracks: { none: {} } },
    });
    await tx.artist.deleteMany({
      where: { libraryId: { in: libraryIds }, syncStatus: "missing", tracks: { none: {} }, albums: { none: {} } },
    });
    return deleted.count;
  });
  console.log(`[LibraryHealth] Hard deleted missing tracks older than ${trackIds?.length ? "selected" : `${days} days`}: ${result}`);
  return NextResponse.json({ deleted: result, days });
}
