export async function register() {
  // Only run in the Node.js runtime (not Edge / browser builds).
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Optional: start a dedicated /metrics HTTP server on its own port so
  // Prometheus can scrape Mixarr. METRICS_PORT=0 (the default) disables
  // it entirely and avoids opening a second listener.
  const metricsPort = Number(process.env.METRICS_PORT || "0");
  if (Number.isFinite(metricsPort) && metricsPort > 0) {
    const { startMetricsServer } = await import('./lib/metrics');
    startMetricsServer(metricsPort);
  } else {
    console.log("[Metrics] Prometheus endpoint disabled (METRICS_PORT is 0 or unset)");
  }

  const cron = await import('node-cron');

  // Read schedule from .env, default to 3:00 AM daily
  const schedule = process.env.SYNC_CRON_SCHEDULE || '0 3 * * *';

  // Safety net so a stuck pipeline can't lock out the next nightly run.
  // The cron callback is fully awaited, so without this cap an axios stall
  // inside one step could pin the whole pipeline indefinitely.
  const MAX_PIPELINE_MS = Number(process.env.SYNC_MAX_PIPELINE_MS || 6 * 60 * 60 * 1000); // 6h

  console.log(`[Scheduler] Initializing autonomous background sync with schedule: ${schedule}`);

  let pipelineRunning = false;

  cron.schedule(schedule, async () => {
    const { pipelineRunsTotal, pipelineDurationSeconds } = await import('./lib/metrics');
    const { GLOBAL_SYNC_JOB_KEY, acquireJobLock, setJobPhase } = await import('./lib/jobLock');

    if (pipelineRunning) {
      console.warn("[Scheduler] Previous nightly pipeline is still running; skipping this tick.");
      pipelineRunsTotal.inc({ result: "skipped" });
      return;
    }
    const lock = acquireJobLock({
      name: "nightly sync pipeline",
      keys: [GLOBAL_SYNC_JOB_KEY, "scheduler"],
      source: "scheduler",
    });
    if (!lock.acquired) {
      console.warn(`[Scheduler] Skipping nightly pipeline; ${lock.activeJob.name} is already running.`);
      pipelineRunsTotal.inc({ result: "skipped" });
      return;
    }
    pipelineRunning = true;
    const endTimer = pipelineDurationSeconds.startTimer();
    let pipelineResult: "success" | "failed" | "timeout" = "success";

    const pipelineStart = Date.now();
    const deadline = pipelineStart + MAX_PIPELINE_MS;
    const remaining = () => deadline - Date.now() > 0;

    console.log("[Scheduler] Starting nightly autonomous sync pipeline...");

    try {
      const prisma = (await import('./lib/prisma')).default;

      // 1. Sync all libraries from Plex
      setJobPhase(lock.job, "Step 1/5: Pulling latest tracks from Plex");
      console.log("[Scheduler] Step 1/5: Pulling latest tracks from Plex...");
      const libraries = await prisma.library.findMany();
      if (libraries.length > 0) {
        const { runSyncEngine } = await import('./lib/syncEngine');
        for (const lib of libraries) {
          if (!remaining()) {
            console.warn(`[Scheduler] Pipeline deadline reached before syncing ${lib.name}; aborting.`);
            pipelineResult = "timeout";
            return;
          }
          console.log(`[Scheduler] Syncing library: ${lib.name} (${lib.id})`);
          await runSyncEngine(lib.id);
        }
      } else {
        console.log("[Scheduler] No libraries found. Skipping Plex sync.");
      }

      // 2. Audio Feature Enrichment - loop until the batch returns 0
      setJobPhase(lock.job, "Step 2/5: Enriching audio features");
      console.log("[Scheduler] Step 2/5: Enriching Audio Features...");
      const { runAudioFeatureEngine } = await import('./lib/audioFeatureEngine');
      const audioDrained = await loopEngine("AudioFeatureEngine", runAudioFeatureEngine, remaining);
      if (!audioDrained) pipelineResult = "timeout";

      // 3. Popularity Enrichment - loop until the batch returns 0
      setJobPhase(lock.job, "Step 3/5: Fetching popularity scores");
      console.log("[Scheduler] Step 3/5: Fetching Popularity Scores...");
      const { runPopularityEngine } = await import('./lib/popularityEngine');
      const popDrained = await loopEngine("PopularityEngine", runPopularityEngine, remaining);
      if (!popDrained) pipelineResult = "timeout";

      // 4. Track Genre Enrichment - loop until the batch returns 0
      setJobPhase(lock.job, "Step 4/5: Fetching track-level genres");
      console.log("[Scheduler] Step 4/5: Fetching Track-Level Genres...");
      const { runTrackTagEngine } = await import('./lib/trackTagEngine');
      const tagsDrained = await loopEngine("TrackTagEngine", runTrackTagEngine, remaining);
      if (!tagsDrained) pipelineResult = "timeout";

      // 5. Refresh saved Plex playlists that opted into auto-refresh.
      // We skip this if an earlier step already hit the deadline, so the
      // next nightly tick still has budget to run.
      if (remaining()) {
        setJobPhase(lock.job, "Step 5/5: Refreshing saved smart playlists");
        console.log("[Scheduler] Step 5/5: Refreshing saved smart playlists...");
        const { refreshAutoPlaylists } = await import('./lib/playlistService');
        const refreshedCount = await refreshAutoPlaylists();
        console.log(`[Scheduler] Refreshed ${refreshedCount} saved smart playlists.`);
      } else {
        console.warn("[Scheduler] Pipeline deadline reached before Step 5/5; skipping playlist refresh.");
        pipelineResult = "timeout";
      }

      const minutes = Math.round((Date.now() - pipelineStart) / 60000);
      if (pipelineResult === "success") {
        console.log(`[Scheduler] 🎉 Autonomous nightly sync pipeline completed successfully! (${minutes} min)`);
      } else {
        console.warn(`[Scheduler] Pipeline exited with status=${pipelineResult} after ${minutes} min`);
      }
    } catch (e) {
      console.error("[Scheduler] ❌ Nightly sync pipeline failed:", e);
      pipelineResult = "failed";
    } finally {
      endTimer();
      pipelineRunsTotal.inc({ result: pipelineResult });
      pipelineRunning = false;
      lock.release();
    }
  });
}

// Drain an enrichment engine by calling it in a loop until it returns 0
// (no more work) or remaining() trips the pipeline deadline. Returns true
// on a clean drain, false on deadline.
async function loopEngine(
  label: string,
  run: () => Promise<number | { attempted: number; processed: number; skipped: number; failed: number }>,
  remaining: () => boolean,
): Promise<boolean> {
  let totalAttempted = 0;
  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let batchNum = 0;
  while (remaining()) {
    batchNum += 1;
    const result = await run();
    const attempted = typeof result === "number" ? result : result.attempted;
    totalAttempted += attempted;
    if (typeof result !== "number") {
      totalProcessed += result.processed;
      totalSkipped += result.skipped;
      totalFailed += result.failed;
    }
    if (attempted === 0) {
      console.log(`[Scheduler] ${label} drained after ${batchNum} batch(es); attempted=${totalAttempted}, processed=${totalProcessed}, skipped=${totalSkipped}, failed=${totalFailed}.`);
      return true;
    }
  }
  console.warn(`[Scheduler] ${label} hit pipeline deadline after ${batchNum} batch(es); attempted=${totalAttempted}, processed=${totalProcessed}, skipped=${totalSkipped}, failed=${totalFailed}; more remain.`);
  return false;
}
