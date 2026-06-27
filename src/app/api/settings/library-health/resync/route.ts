import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { getUserSyncSettings } from "@/lib/syncSettings";
import { alreadyRunningPayload, startSyncJobInBackground } from "@/lib/syncJobRunner";

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { libraryId } = await request.json().catch(() => ({}));
  if (!libraryId) return NextResponse.json({ error: "Library ID required" }, { status: 400 });
  const library = await prisma.library.findFirst({ where: { id: libraryId, server: { userId } } });
  if (!library) return NextResponse.json({ error: "Library not found" }, { status: 404 });
  const running = await prisma.syncLog.findFirst({ where: { libraryId, status: "in_progress" }, orderBy: { startedAt: "desc" } });
  if (running) {
    const interruptedAfterHours = Number(process.env.SYNC_INTERRUPTED_AFTER_HOURS || 6);
    const isInterrupted = Date.now() - running.startedAt.getTime() > interruptedAfterHours * 3_600_000;
    if (!isInterrupted) return NextResponse.json({ status: "already_running", syncRunId: running.id });
    await prisma.syncLog.update({
      where: { id: running.id },
      data: { status: "failed", endedAt: new Date(), error: "Sync was interrupted before reconciliation completed" },
    });
  }

  const settings = await getUserSyncSettings(userId);
  const started = startSyncJobInBackground({
    engine: "plex",
    libraryId,
    task: () => import("@/lib/syncEngine").then((m) => m.runSyncEngine(libraryId, settings)),
  });
  if (!started.started) return NextResponse.json(alreadyRunningPayload("plex", started.activeJob));
  return NextResponse.json({ status: "started" }, { status: 202 });
}
