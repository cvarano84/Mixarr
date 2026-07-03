import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { runSyncEngine } from "@/lib/syncEngine";
import { getAudioFeatureHealthSummary, logPartialAudioFeatureRetryResult } from "@/lib/libraryHealth";
import { getUserSyncSettings, resolveMetadataProviderSettings } from "@/lib/syncSettings";
import { alreadyRunningPayload, startSyncJobInBackground } from "@/lib/syncJobRunner";

export async function POST(req: Request) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { libraryId, engine = 'plex', providerMode, audioFeaturePartialBefore, filter, trackIds, force } = body;
    const baseSyncSettings = await getUserSyncSettings(userId);
    const syncSettings = {
      ...baseSyncSettings,
      ...(engine === "bpm" && providerMode === "api_only" ? { enableApiBpm: true, enableLocalBpm: false } : {}),
      ...(engine === "bpm" && (providerMode === "local_only" || providerMode === "force_local") ? {
        enableApiBpm: false,
        enableLocalBpm: true,
        preferLocalBpm: true,
        reprocessApiBpmWithLocal: true,
      } : {}),
      ...(engine === "bpm" ? {
        bpmBackfillFilter: typeof filter === "string" ? filter : null,
        bpmBackfillLibraryId: typeof libraryId === "string" ? libraryId : null,
        bpmBackfillUserId: userId,
        bpmBackfillTrackIds: Array.isArray(trackIds) ? trackIds.filter((id) => typeof id === "string") : null,
        bpmBackfillForce: providerMode === "force_local" || force === true,
        bpmBackfillProviderMode: typeof providerMode === "string" ? providerMode : "configured",
      } : {}),
      ...(engine === "audio" && providerMode === "api_only" ? { enableApiAudioFeatures: true, enableLocalAudioFeatures: false } : {}),
      ...(engine === "audio" && (providerMode === "local_only" || providerMode === "force_local") ? {
        enableApiAudioFeatures: false,
        enableLocalAudioFeatures: true,
        preferLocalAudioFeatures: true,
        reprocessApiAudioFeaturesWithLocal: providerMode === "force_local",
      } : {}),
    };
    let started;

    if (engine === 'initial') {
      started = startSyncJobInBackground({
        engine,
        task: () => runInitialEnrichment(syncSettings),
      });
    } else if (engine === 'plex') {
      if (!libraryId) return NextResponse.json({ error: "Library ID required" }, { status: 400 });
      started = startSyncJobInBackground({
        engine,
        libraryId,
        task: () => runSyncEngine(libraryId, syncSettings),
      });
    } else if (engine === 'popularity') {
      started = startSyncJobInBackground({
        engine,
        trackedEngine: engine,
        task: () => import('@/lib/popularityEngine').then(m => m.runPopularityEngine(syncSettings)),
      });
    } else if (engine === 'audio') {
      started = startSyncJobInBackground({
        engine,
        trackedEngine: engine,
        task: async () => {
          const beforePartial = typeof audioFeaturePartialBefore === "number"
            ? audioFeaturePartialBefore
            : (await getAudioFeatureHealthSummary(userId, libraryId)).partial;
          const audio = await import('@/lib/audioFeatureEngine');
          const apiSummary = await audio.runAudioFeatureEngine(syncSettings);
          const local = await import('@/lib/localAudioFeatureEngine');
          const localSummary = await local.runLocalAudioFeatureEngine(syncSettings);
          await logPartialAudioFeatureRetryResult({
            userId,
            libraryId,
            before: beforePartial,
            processed: localSummary.processed,
            failed: localSummary.failed,
          });
          revalidatePath("/settings/library-health");
          return {
            attempted: apiSummary.attempted + localSummary.attempted,
            processed: apiSummary.processed + localSummary.processed,
            skipped: apiSummary.skipped + localSummary.skipped,
            failed: apiSummary.failed + localSummary.failed,
          };
        },
      });
    } else if (engine === 'bpm') {
      started = startSyncJobInBackground({
        engine,
        trackedEngine: engine,
        task: () => import('@/lib/localBpmEngine').then(m => m.runLocalBpmEngine(syncSettings)),
      });
    } else if (engine === 'tags') {
      started = startSyncJobInBackground({
        engine,
        trackedEngine: engine,
        task: () => import('@/lib/trackTagEngine').then(m => m.runTrackTagEngine(syncSettings)),
      });
    } else {
      return NextResponse.json({ error: "Unknown engine" }, { status: 400 });
    }

    if (!started.started) {
      return NextResponse.json(alreadyRunningPayload(engine, started.activeJob));
    }

    return NextResponse.json({ status: "started", message: `${engine} sync job initiated` });
  } catch (error) {
    console.error("Failed to start sync", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function runInitialEnrichment(syncSettings: Awaited<ReturnType<typeof getUserSyncSettings>>) {
  console.log("[InitialSync] Starting recommended enrichment sequence...");

  const [
    popularity,
    tags,
    audio,
    bpm,
  ] = await Promise.all([
    import('@/lib/popularityEngine'),
    import('@/lib/trackTagEngine'),
    import('@/lib/audioFeatureEngine'),
    import('@/lib/localBpmEngine'),
  ]);

  await popularity.runPopularityEngine(syncSettings);
  await tags.runTrackTagEngine(syncSettings);
  await audio.runAudioFeatureEngine(syncSettings);
  const metadataSettings = resolveMetadataProviderSettings(syncSettings);
  if (metadataSettings.audioFeatures.local && (!metadataSettings.audioFeatures.api || localAudioFeaturesAutoBackfillEnabled())) {
    await (await import('@/lib/localAudioFeatureEngine')).runLocalAudioFeatureEngine(syncSettings);
  } else {
    console.log("[InitialSync] Skipping local Essentia audio feature backfill; set LOCAL_AUDIO_FEATURES_AUTO_BACKFILL=1 to include it in automatic initial enrichment.");
  }
  await bpm.runLocalBpmEngine(syncSettings);

  console.log("[InitialSync] Recommended enrichment sequence completed.");
}

function localAudioFeaturesAutoBackfillEnabled() {
  return ["1", "true", "yes", "on"].includes(String(process.env.LOCAL_AUDIO_FEATURES_AUTO_BACKFILL || "").trim().toLowerCase());
}
