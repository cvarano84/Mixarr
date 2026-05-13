export async function register() {
  // Only run the cron job in the Node.js runtime (avoids running in Edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const cron = await import('node-cron');
    
    // Read schedule from .env, default to 3:00 AM daily
    const schedule = process.env.SYNC_CRON_SCHEDULE || '0 3 * * *';
    
    console.log(`[Scheduler] Initializing autonomous background sync with schedule: ${schedule}`);
    
    cron.schedule(schedule, async () => {
      console.log("[Scheduler] Starting nightly autonomous sync pipeline...");
      
      try {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();
        
        // 1. Sync all libraries from Plex
        console.log("[Scheduler] Step 1/4: Pulling latest tracks from Plex...");
        const libraries = await prisma.library.findMany();
        if (libraries.length > 0) {
          const { runSyncEngine } = await import('./lib/syncEngine');
          for (const lib of libraries) {
            console.log(`[Scheduler] Syncing library: ${lib.name} (${lib.id})`);
            await runSyncEngine(lib.id);
          }
        } else {
          console.log("[Scheduler] No libraries found. Skipping Plex sync.");
        }

        // 2. Run Audio Feature Enrichment
        console.log("[Scheduler] Step 2/4: Enriching Audio Features...");
        const { runAudioFeatureEngine } = await import('./lib/audioFeatureEngine');
        await runAudioFeatureEngine();

        // 3. Run Popularity Enrichment
        console.log("[Scheduler] Step 3/4: Fetching Popularity Scores...");
        const { runPopularityEngine } = await import('./lib/popularityEngine');
        await runPopularityEngine();

        // 4. Run Track Genre Enrichment
        console.log("[Scheduler] Step 4/4: Fetching Track-Level Genres...");
        const { runTrackTagEngine } = await import('./lib/trackTagEngine');
        await runTrackTagEngine();

        console.log("[Scheduler] 🎉 Autonomous nightly sync pipeline completed successfully!");
      } catch (e) {
        console.error("[Scheduler] ❌ Nightly sync pipeline failed:", e);
      }
    });
  }
}
