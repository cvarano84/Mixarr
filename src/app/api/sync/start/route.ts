import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { runSyncEngine } from "@/lib/syncEngine";

export async function POST(req: Request) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { libraryId, engine = 'plex' } = body;

    // Fire and forget the requested engine. For the three enrichment engines
    // we keep calling the batch entry point until it returns 0, so a single
    // manual "Start" click actually drains the work queue instead of
    // processing just one batch.
    if (engine === 'plex') {
      if (!libraryId) return NextResponse.json({ error: "Library ID required" }, { status: 400 });
      runSyncEngine(libraryId).catch(console.error);
    } else if (engine === 'popularity') {
      import('@/lib/popularityEngine')
        .then(m => drain("PopularityEngine", m.runPopularityEngine))
        .catch(console.error);
    } else if (engine === 'audio') {
      import('@/lib/audioFeatureEngine')
        .then(m => drain("AudioFeatureEngine", m.runAudioFeatureEngine))
        .catch(console.error);
    } else if (engine === 'tags') {
      import('@/lib/trackTagEngine')
        .then(m => drain("TrackTagEngine", m.runTrackTagEngine))
        .catch(console.error);
    } else {
      return NextResponse.json({ error: "Unknown engine" }, { status: 400 });
    }

    return NextResponse.json({ status: "started", message: `${engine} sync job initiated` });
  } catch (error) {
    console.error("Failed to start sync", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Repeatedly invoke an enrichment engine in the background until it reports
 * the work queue is empty. Returning the empty batch (0 attempts) is the
 * loop's termination signal.
 */
async function drain(label: string, run: () => Promise<number>): Promise<void> {
  let totalAttempted = 0;
  let batchNum = 0;
  try {
    while (true) {
      batchNum += 1;
      const attempted = await run();
      totalAttempted += attempted;
      if (attempted === 0) {
        console.log(`[ManualSync] ${label} drained after ${batchNum} batch(es); ${totalAttempted} total tracks attempted.`);
        return;
      }
    }
  } catch (e) {
    console.error(`[ManualSync] ${label} crashed after ${batchNum} batch(es); ${totalAttempted} attempted:`, e);
  }
}
