import { NextResponse } from "next/server";
import { cookies } from "next/headers";
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
      engine: "popularity",
      trackedEngine: "popularity",
      task: () => import("@/lib/popularityEngine").then((m) => m.runPopularityEngine(syncSettings)),
    });

    if (!started.started) {
      return NextResponse.json(alreadyRunningPayload("popularity", started.activeJob));
    }

    return NextResponse.json({ status: "started", message: "Popularity sync job initiated" });
  } catch (error) {
    console.error("Failed to start popularity sync", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
