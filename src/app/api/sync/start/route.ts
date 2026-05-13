import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
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

    // Fire and forget the requested engine
    if (engine === 'plex') {
      if (!libraryId) return NextResponse.json({ error: "Library ID required" }, { status: 400 });
      runSyncEngine(libraryId).catch(console.error);
    } else if (engine === 'popularity') {
      import('@/lib/popularityEngine').then(m => m.runPopularityEngine().catch(console.error));
    } else if (engine === 'audio') {
      import('@/lib/audioFeatureEngine').then(m => m.runAudioFeatureEngine().catch(console.error));
    } else if (engine === 'tags') {
      import('@/lib/trackTagEngine').then(m => m.runTrackTagEngine().catch(console.error));
    } else {
      return NextResponse.json({ error: "Unknown engine" }, { status: 400 });
    }

    return NextResponse.json({ status: "started", message: `${engine} sync job initiated` });
  } catch (error) {
    console.error("Failed to start sync", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
