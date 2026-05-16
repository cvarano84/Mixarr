import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic';

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
      prisma.popularity.count({ where: { provider: { not: "not_found" } } }),
      prisma.popularity.count(),
      prisma.audioFeature.count({
        where: {
          OR: [
            { energy: { not: null } },
            { valence: { not: null } },
            { danceability: { not: null } },
          ],
        },
      }),
      prisma.audioFeature.count(),
      prisma.audioFeature.count({
        where: {
          tempo: { not: null },
          tempoConfidence: { gte: 0.5 },
        },
      }),
      prisma.track.count({
        where: {
          tagsSyncedAt: { not: null },
          tags: { some: { type: "genre" } },
        },
      }),
      prisma.track.count({ where: { tagsSyncedAt: { not: null } } }),
      prisma.syncLog.findMany({ where: { status: "in_progress" } }),
    ]);

    const percentage = (processed: number) =>
      totalTracks > 0 ? Math.round((processed / totalTracks) * 100) : 0;

    return NextResponse.json({
      popularity: {
        total: totalTracks,
        processed: popularityWithData,
        attempted: popularityAttempted,
        percentage: percentage(popularityWithData),
        isComplete: totalTracks > 0 && popularityWithData >= totalTracks,
      },
      audioFeatures: {
        total: totalTracks,
        processed: audioFeaturesWithData,
        attempted: audioFeaturesAttempted,
        percentage: percentage(audioFeaturesWithData),
        isComplete: totalTracks > 0 && audioFeaturesWithData >= totalTracks,
      },
      bpm: {
        total: totalTracks,
        processed: bpmWithData,
        attempted: audioFeaturesAttempted,
        percentage: percentage(bpmWithData),
        isComplete: totalTracks > 0 && bpmWithData >= totalTracks,
      },
      tags: {
        total: totalTracks,
        processed: tagsWithData,
        attempted: tagsAttempted,
        percentage: percentage(tagsWithData),
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
