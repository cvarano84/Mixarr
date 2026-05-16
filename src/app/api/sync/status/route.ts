import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic';

/**
 * GET /api/sync/status
 *
 * Returns enrichment progress for each engine in two flavors:
 *   - `processed`: tracks the engine has produced *real data* for. This is
 *     what drives the percentage / progress bar in the UI because it's
 *     what the user actually cares about ("how much of my library has
 *     popularity / audio features / tags?").
 *   - `attempted`: tracks the engine has *touched* at all - includes
 *     "not_found" marker rows that the engine wrote so it doesn't retry
 *     the same hopeless track every cron tick for 14 days. The UI
 *     shows this underneath the progress bar as a secondary stat so
 *     you can see e.g. "45 with data · 12,617 attempted" and immediately
 *     spot when an engine is busy but coming up empty.
 *
 * The "have real data" predicates here intentionally mirror the ones
 * used in `refreshStateGauges` in src/lib/metrics.ts so the UI and the
 * Grafana dashboard always agree.
 */
export async function GET() {
  try {
    const [
      totalTracks,
      popularityWithData,
      popularityAttempted,
      audioFeaturesWithData,
      audioFeaturesAttempted,
      bpmWithData,
      tagsWithData,
      tagsAttempted,
      activeSyncs,
    ] = await Promise.all([
      prisma.track.count(),
      // popularity: a "real" row is anything that isn't a not_found marker
      prisma.popularity.count({ where: { provider: { not: "not_found" } } }),
      prisma.popularity.count(),
      // audio features: a "real" row has at least one of the four fields populated
      prisma.audioFeature.count({
        where: {
          OR: [
            { energy: { not: null } },
            { valence: { not: null } },
            { danceability: { not: null } },
            { tempo: { not: null } },
          ],
        },
      }),
      prisma.audioFeature.count(),
      // bpm: tempo specifically. Note attempted for bpm is the same as
      // attempted for audio features - they share the same engine and
      // the same row, BPM is just one column on that row.
      prisma.audioFeature.count({ where: { tempo: { not: null } } }),
      // tags: a "real" row has at least one genre tag connected
      prisma.track.count({
        where: {
          tagsSyncedAt: { not: null },
          tags: { some: { type: "genre" } },
        },
      }),
      prisma.track.count({ where: { tagsSyncedAt: { not: null } } }),
      // Active Plex library syncs (for the "Plex Library" tile's spinner)
      prisma.syncLog.findMany({ where: { status: "in_progress" } }),
    ]);

    const pct = (n: number) =>
      totalTracks > 0 ? Math.round((n / totalTracks) * 100) : 0;

    return NextResponse.json({
      popularity: {
        total: totalTracks,
        processed: popularityWithData,
        attempted: popularityAttempted,
        percentage: pct(popularityWithData),
        isComplete: totalTracks > 0 && popularityWithData >= totalTracks,
      },
      audioFeatures: {
        total: totalTracks,
        processed: audioFeaturesWithData,
        attempted: audioFeaturesAttempted,
        percentage: pct(audioFeaturesWithData),
        isComplete: totalTracks > 0 && audioFeaturesWithData >= totalTracks,
      },
      bpm: {
        total: totalTracks,
        processed: bpmWithData,
        attempted: audioFeaturesAttempted,
        percentage: pct(bpmWithData),
        isComplete: totalTracks > 0 && bpmWithData >= totalTracks,
      },
      tags: {
        total: totalTracks,
        processed: tagsWithData,
        attempted: tagsAttempted,
        percentage: pct(tagsWithData),
        isComplete: totalTracks > 0 && tagsWithData >= totalTracks,
      },
      metadata: {
        isSyncing: activeSyncs.length > 0,
      },
    });
  } catch (error) {
    console.error("Status fetch error", error);
    return NextResponse.json({ error: "Failed to get status" }, { status: 500 });
  }
}
