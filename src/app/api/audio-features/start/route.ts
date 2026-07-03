import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getUserSyncSettings } from "@/lib/syncSettings";
import { alreadyRunningPayload, startSyncJobInBackground } from "@/lib/syncJobRunner";

export async function POST() {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const syncSettings = await getUserSyncSettings(userId);
    const started = startSyncJobInBackground({
      engine: "audio",
      trackedEngine: "audio",
      task: async () => {
        const audio = await import("@/lib/audioFeatureEngine");
        const apiSummary = await audio.runAudioFeatureEngine(syncSettings);
        const local = await import("@/lib/localAudioFeatureEngine");
        const localSummary = await local.runLocalAudioFeatureEngine(syncSettings);
        revalidatePath("/settings/library-health");
        return {
          attempted: apiSummary.attempted + localSummary.attempted,
          processed: apiSummary.processed + localSummary.processed,
          skipped: apiSummary.skipped + localSummary.skipped,
          failed: apiSummary.failed + localSummary.failed,
        };
      },
    });

    if (!started.started) {
      return NextResponse.json(alreadyRunningPayload("audio", started.activeJob));
    }

    return NextResponse.json({ status: "started", message: "Audio Feature sync job initiated" });
  } catch (error) {
    console.error("Failed to start audio feature sync", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
