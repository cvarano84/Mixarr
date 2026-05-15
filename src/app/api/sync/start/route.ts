import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { runSyncEngine } from "@/lib/syncEngine";

/**
 * Set of engine "slots" that currently have a drain loop in flight in
 * this process. Module-level state is safe because Next.js reuses this
 * route handler module across all requests to /api/sync/start.
 *
 * Without this, repeatedly clicking "Start" in the UI fires off N parallel
 * drain loops, each one independently grabbing the same `take: 2000`
 * window from Prisma. Upserts are idempotent so the DB doesn't corrupt,
 * but every batch doubles (or triples...) the upstream API calls to
 * Deezer / Last.fm / Spotify / AudioDB and burns through whatever
 * rate-limit budget those have.
 *
 * Plex syncs are keyed per-library so two different libraries can still
 * sync in parallel; the enrichment engines (popularity / audio / tags)
 * are global - only one of each can be draining at a time.
 */
const inflightEngines = new Set<string>();

type DrainSpec = {
  label: string;
  load: () => Promise<() => Promise<number>>;
};

const ENGINE_SPECS: Record<string, DrainSpec> = {
  popularity: {
    label: "PopularityEngine",
    load: () => import("@/lib/popularityEngine").then(m => m.runPopularityEngine),
  },
  audio: {
    label: "AudioFeatureEngine",
    load: () => import("@/lib/audioFeatureEngine").then(m => m.runAudioFeatureEngine),
  },
  tags: {
    label: "TrackTagEngine",
    load: () => import("@/lib/trackTagEngine").then(m => m.runTrackTagEngine),
  },
};

export async function POST(req: Request) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { libraryId, engine = 'plex' } = body;

    // Plex library sync: keyed per-library so different libraries can
    // still run in parallel.
    if (engine === 'plex') {
      if (!libraryId) {
        return NextResponse.json({ error: "Library ID required" }, { status: 400 });
      }
      const key = `plex:${libraryId}`;
      if (inflightEngines.has(key)) {
        return NextResponse.json({
          status: "already_running",
          message: `Plex sync for library ${libraryId} is already in progress; ignoring duplicate request`,
        });
      }
      inflightEngines.add(key);
      runSyncEngine(libraryId)
        .catch(console.error)
        .finally(() => inflightEngines.delete(key));
      return NextResponse.json({ status: "started", message: "plex sync job initiated" });
    }

    // Enrichment engines: one global slot per engine.
    const spec = ENGINE_SPECS[engine];
    if (!spec) {
      return NextResponse.json({ error: "Unknown engine" }, { status: 400 });
    }

    if (inflightEngines.has(engine)) {
      return NextResponse.json({
        status: "already_running",
        message: `${engine} sync is already in progress; ignoring duplicate request`,
      });
    }
    inflightEngines.add(engine);
    spec.load()
      .then(run => drain(spec.label, run))
      .catch(console.error)
      .finally(() => inflightEngines.delete(engine));

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
