import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { runSyncEngine } from "@/lib/syncEngine";
import { getUserSyncSettings } from "@/lib/syncSettings";

const inflightEngines = new Set<string>();

const engineLabels: Record<string, string> = {
  plex: "Plex",
  popularity: "popularity",
  audio: "audio features",
  bpm: "BPM",
  tags: "track genres",
};

function alreadyRunning(key: string, engine: string) {
  if (!inflightEngines.has(key)) return null;

  return NextResponse.json({
    status: "already_running",
    message: `${engineLabels[engine] || engine} sync is already in progress`,
  });
}

function runInBackground(key: string, task: () => Promise<unknown>) {
  inflightEngines.add(key);
  task()
    .catch(console.error)
    .finally(() => inflightEngines.delete(key));
}

export async function POST(req: Request) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { libraryId, engine = 'plex' } = body;
    const syncSettings = await getUserSyncSettings(userId);

    if (engine === 'plex') {
      if (!libraryId) return NextResponse.json({ error: "Library ID required" }, { status: 400 });
      const key = `plex:${libraryId}`;
      const duplicate = alreadyRunning(key, engine);
      if (duplicate) return duplicate;

      runInBackground(key, () => runSyncEngine(libraryId, syncSettings));
    } else if (engine === 'popularity') {
      const duplicate = alreadyRunning(engine, engine);
      if (duplicate) return duplicate;

      runInBackground(engine, () => import('@/lib/popularityEngine').then(m => m.runPopularityEngine(syncSettings)));
    } else if (engine === 'audio') {
      const duplicate = alreadyRunning(engine, engine);
      if (duplicate) return duplicate;

      runInBackground(engine, () => import('@/lib/audioFeatureEngine').then(m => m.runAudioFeatureEngine(syncSettings)));
    } else if (engine === 'bpm') {
      const duplicate = alreadyRunning(engine, engine);
      if (duplicate) return duplicate;

      runInBackground(engine, () => import('@/lib/localBpmEngine').then(m => m.runLocalBpmEngine(syncSettings)));
    } else if (engine === 'tags') {
      const duplicate = alreadyRunning(engine, engine);
      if (duplicate) return duplicate;

      runInBackground(engine, () => import('@/lib/trackTagEngine').then(m => m.runTrackTagEngine(syncSettings)));
    } else {
      return NextResponse.json({ error: "Unknown engine" }, { status: 400 });
    }

    return NextResponse.json({ status: "started", message: `${engine} sync job initiated` });
  } catch (error) {
    console.error("Failed to start sync", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
