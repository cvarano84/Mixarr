import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const totalTracks = await prisma.track.count();
    const processedTracks = await prisma.popularity.count();
    const processedAudioFeatures = await prisma.audioFeature.count();
    const processedBpm = await prisma.audioFeature.count({ where: { tempo: { not: null } } });
    const processedTags = await prisma.track.count({ where: { tagsSyncedAt: { not: null } } });
    
    // Check if there are any active library syncs
    const activeSyncs = await prisma.syncLog.findMany({
      where: { status: "in_progress" },
    });

    return NextResponse.json({
      popularity: {
        total: totalTracks,
        processed: processedTracks,
        percentage: totalTracks > 0 ? Math.round((processedTracks / totalTracks) * 100) : 0,
        isComplete: totalTracks > 0 && processedTracks >= totalTracks,
      },
      audioFeatures: {
        total: totalTracks,
        processed: processedAudioFeatures,
        percentage: totalTracks > 0 ? Math.round((processedAudioFeatures / totalTracks) * 100) : 0,
        isComplete: totalTracks > 0 && processedAudioFeatures >= totalTracks,
      },
      bpm: {
        total: totalTracks,
        processed: processedBpm,
        percentage: totalTracks > 0 ? Math.round((processedBpm / totalTracks) * 100) : 0,
        isComplete: totalTracks > 0 && processedBpm >= totalTracks,
      },
      tags: {
        total: totalTracks,
        processed: processedTags,
        percentage: totalTracks > 0 ? Math.round((processedTags / totalTracks) * 100) : 0,
        isComplete: totalTracks > 0 && processedTags >= totalTracks,
      },
      metadata: {
        isSyncing: activeSyncs.length > 0,
      }
    });
  } catch (error) {
    console.error("Status fetch error", error);
    return NextResponse.json({ error: "Failed to get status" }, { status: 500 });
  }
}
