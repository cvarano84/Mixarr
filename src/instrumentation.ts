export async function register() {
  // Only run the cron job in the Node.js runtime (avoids running in Edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const cron = await import('node-cron');

    // Read schedule from .env, default to 3:00 AM daily
    const schedule = process.env.SYNC_CRON_SCHEDULE || '0 3 * * *';

    // Safety net so a stuck pipeline can't lock out the next nightly run.
    // The cron callback's whole body is awaited; without this an axios call
    // (or any unbounded await) inside a step could pin the pipeline forever.
    const MAX_PIPELINE_MS = Number(process.env.SYNC_MAX_PIPELINE_MS || 6 * 60 * 60 * 1000); // 6h

    console.log(`[Scheduler] Initializing autonomous background sync with schedule: ${schedule}`);

    let pipelineRunning = false;

    cron.schedule(schedule, async () => {
      if (pipelineRunning) {
        console.warn("[Scheduler] Previous nightly pipeline is still running; skipping this tick.");
        return;
      }
      pipelineRunning = true;
      const pipelineStart = Date.now();
      const deadline = pipelineStart + MAX_PIPELINE_MS;
      const remaining = () => deadline - Date.now() > 0;

      console.log("[Scheduler] Starting nightly autonomous sync pipeline...");

      try {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        // 1. Sync all libraries from Plex
        console.log("[Scheduler] Step 1/5: Pulling latest tracks from Plex...");
        const libraries = await prisma.library.findMany();
        if (libraries.length > 0) {
          const { runSyncEngine } = await import('./lib/syncEngine');
          for (const lib of libraries) {
            if (!remaining()) {
              console.warn(`[Scheduler] Pipeline deadline reached before syncing ${lib.name}; aborting.`);
              return;
            }
            console.log(`[Scheduler] Syncing library: ${lib.name} (${lib.id})`);
            await runSyncEngine(lib.id);
          }
        } else {
          console.log("[Scheduler] No libraries found. Skipping Plex sync.");
        }

        // 2. Audio Feature Enrichment - loop until the batch returns 0
        console.log("[Scheduler] Step 2/5: Enriching Audio Features...");
        const { runAudioFeatureEngine } = await import('./lib/audioFeatureEngine');
        await loopEngine("AudioFeatureEngine", runAudioFeatureEngine, remaining);

        // 3. Popularity Enrichment - loop until the batch returns 0
        console.log("[Scheduler] Step 3/5: Fetching Popularity Scores...");
        const { runPopularityEngine } = await import('./lib/popularityEngine');
        await loopEngine("PopularityEngine", runPopularityEngine, remaining);

        // 4. Track Genre Enrichment - loop until the batch returns 0
        console.log("[Scheduler] Step 4/5: Fetching Track-Level Genres...");
        const { runTrackTagEngine } = await import('./lib/trackTagEngine');
        await loopEngine("TrackTagEngine", runTrackTagEngine, remaining);

        // 5. Refresh saved Plex playlists that opted into auto-refresh.
        // This consumes whatever pipeline budget remains after the
        // enrichment loops; if any of those hit the deadline we still
        // try to refresh playlists so the user sees fresh results even
        // when the catalog isn't fully indexed yet.
        if (remaining()) {
          console.log("[Scheduler] Step 5/5: Refreshing saved smart playlists...");
          const { refreshAutoPlaylists } = await import('./lib/playlistService');
          const refreshedCount = await refreshAutoPlaylists();
          console.log(`[Scheduler] Refreshed ${refreshedCount} saved smart playlists.`);
        } else {
          console.warn("[Scheduler] Pipeline deadline reached before Step 5/5; skipping playlist refresh.");
        }

        const minutes = Math.round((Date.now() - pipelineStart) / 60000);
        console.log(`[Scheduler] 🎉 Autonomous nightly sync pipeline completed successfully! (${minutes} min)`);
      } catch (e) {
        console.error("[Scheduler] ❌ Nightly sync pipeline failed:", e);
      } finally {
        pipelineRunning = false;
      }
    });
  }
}

/**
 * Repeatedly invoke an enrichment engine until it reports it has nothing left
 * to do (returns 0). This is what actually drains the work queue, instead of
 * relying on one batch per nightly cron tick.
 *
 * `remaining()` is consulted between batches so a stuck or slow run can't
 * exceed the pipeline-level deadline.
 */
async function loopEngine(
  label: string,
  run: () => Promise<number>,
  remaining: () => boolean,
): Promise<void> {
  let totalAttempted = 0;
  let batchNum = 0;
  while (remaining()) {
    batchNum += 1;
    const attempted = await run();
    totalAttempted += attempted;
    if (attempted === 0) {
      console.log(`[Scheduler] ${label} drained after ${batchNum} batch(es); ${totalAttempted} total tracks attempted.`);
      return;
    }
  }
  console.warn(`[Scheduler] ${label} hit pipeline deadline after ${batchNum} batch(es); ${totalAttempted} tracks attempted, more remain.`);
}
