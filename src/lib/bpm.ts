import type { Prisma } from "@prisma/client";

export const bpmAnalysisStatuses = ["success", "no_data", "failed", "extraction_failed", "analyzer_failed"] as const;
export type BpmAnalysisStatus = typeof bpmAnalysisStatuses[number];

export type TrackWithBpmSources = {
  bpm?: unknown;
  bpmAnalysisStatus?: unknown;
  bpmAnalyzedAt?: unknown;
  tempo?: unknown;
  localBpm?: unknown;
  analyzedBpm?: unknown;
  audioFeature?: {
    bpm?: unknown;
    tempo?: unknown;
  } | null;
  audioFeatures?: {
    bpm?: unknown;
    tempo?: unknown;
  } | null;
  analysis?: {
    bpm?: unknown;
    tempo?: unknown;
  } | null;
};

export function getValidBpm(value: unknown) {
  const bpm = Number(value);
  return Number.isFinite(bpm) && bpm > 0 ? bpm : null;
}

export function getEffectiveBpm(track: TrackWithBpmSources) {
  const candidates = [
    track.bpm,
    track.localBpm,
    track.audioFeatures?.bpm,
    track.audioFeatures?.tempo,
    track.audioFeature?.bpm,
    track.audioFeature?.tempo,
    track.analysis?.bpm,
    track.analysis?.tempo,
    track.analyzedBpm,
    track.tempo,
  ];

  for (const candidate of candidates) {
    const bpm = getValidBpm(candidate);
    if (bpm !== null) return bpm;
  }

  return null;
}

export function effectiveBpmTrackWhere(
  condition: Prisma.FloatNullableFilter<"AudioFeature"> | number = { gt: 0 },
): Prisma.TrackWhereInput {
  return {
    OR: [
      { bpm: condition as Prisma.FloatNullableFilter<"Track"> | number },
      {
        AND: [
          {
            OR: [
              { bpm: null },
              { bpm: { lte: 0 } },
            ],
          },
          {
            audioFeature: {
              is: {
                tempo: condition,
              },
            },
          },
        ],
      },
    ],
  };
}

export function missingEffectiveBpmTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      {
        OR: [
          { bpm: null },
          { bpm: { lte: 0 } },
        ],
      },
      {
        OR: [
          { audioFeature: null },
          {
            audioFeature: {
              is: {
                OR: [
                  { tempo: null },
                  { tempo: { lte: 0 } },
                ],
              },
            },
          },
        ],
      },
    ],
  };
}

export function localBpmSourceTrackWhere(): Prisma.TrackWhereInput {
  return {
    audioFeature: {
      is: {
        OR: [
          { tempoSource: { startsWith: "Essentia" } },
          { tempoSource: { startsWith: "Aubio" } },
          { tempoSource: { in: ["local_not_found", "local_failed", "local_extraction_failed", "local_analyzer_failed"] } },
        ],
      },
    },
  };
}

export function bpmAnalysisAttemptedTrackWhere(): Prisma.TrackWhereInput {
  return {
    OR: [
      { bpmAnalyzedAt: { not: null } },
      { bpmAnalysisStatus: { in: [...bpmAnalysisStatuses] } },
      localBpmSourceTrackWhere(),
    ],
  };
}

export function bpmNoDataMarkerTrackWhere(): Prisma.TrackWhereInput {
  return {
    OR: [
      { bpmAnalysisStatus: "no_data" },
      {
        audioFeature: {
          is: {
            tempoSource: "local_not_found",
          },
        },
      },
    ],
  };
}

export function bpmFailedMarkerTrackWhere(): Prisma.TrackWhereInput {
  return {
    OR: [
      { bpmAnalysisStatus: "failed" },
      {
        audioFeature: {
          is: {
            tempoSource: "local_failed",
          },
        },
      },
    ],
  };
}

export function bpmExtractionFailedMarkerTrackWhere(): Prisma.TrackWhereInput {
  return {
    OR: [
      { bpmAnalysisStatus: "extraction_failed" },
      {
        audioFeature: {
          is: {
            tempoSource: "local_extraction_failed",
          },
        },
      },
    ],
  };
}

export function bpmAnalyzerFailedMarkerTrackWhere(): Prisma.TrackWhereInput {
  return {
    OR: [
      { bpmAnalysisStatus: "analyzer_failed" },
      {
        audioFeature: {
          is: {
            tempoSource: "local_analyzer_failed",
          },
        },
      },
    ],
  };
}

export function bpmNoDataTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingEffectiveBpmTrackWhere(),
      bpmNoDataMarkerTrackWhere(),
    ],
  };
}

export function bpmLegacyFailedTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingEffectiveBpmTrackWhere(),
      bpmFailedMarkerTrackWhere(),
    ],
  };
}

/** All terminal BPM failures. This intentionally includes legacy, extraction,
 * and analyzer failures so the umbrella count cannot disagree with its parts. */
export function bpmFailedTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingEffectiveBpmTrackWhere(),
      {
        OR: [
          bpmFailedMarkerTrackWhere(),
          bpmExtractionFailedMarkerTrackWhere(),
          bpmAnalyzerFailedMarkerTrackWhere(),
        ],
      },
    ],
  };
}

export function bpmExtractionFailedTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingEffectiveBpmTrackWhere(),
      bpmExtractionFailedMarkerTrackWhere(),
    ],
  };
}

export function bpmAnalyzerFailedTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingEffectiveBpmTrackWhere(),
      bpmAnalyzerFailedMarkerTrackWhere(),
    ],
  };
}

export function noEffectiveBpmTrackWhere(): Prisma.TrackWhereInput {
  return missingEffectiveBpmTrackWhere();
}

export function pendingBpmBackfillTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingEffectiveBpmTrackWhere(),
      {
        OR: [
          { bpmAnalysisStatus: null },
          { bpmAnalysisStatus: { notIn: [...bpmAnalysisStatuses] } },
        ],
      },
      { NOT: bpmNoDataMarkerTrackWhere() },
      { NOT: bpmFailedMarkerTrackWhere() },
      { NOT: bpmExtractionFailedMarkerTrackWhere() },
      { NOT: bpmAnalyzerFailedMarkerTrackWhere() },
    ],
  };
}

export function bpmBackfillCandidateTrackWhere(options: {
  retryNoDataFailed?: boolean;
  includeAubioReprocess?: boolean;
} = {}): Prisma.TrackWhereInput {
  const missingBpmWhere: Prisma.TrackWhereInput = options.retryNoDataFailed
    ? missingEffectiveBpmTrackWhere()
    : pendingBpmBackfillTrackWhere();

  if (!options.includeAubioReprocess) return missingBpmWhere;

  return {
    OR: [
      missingBpmWhere,
      {
        audioFeature: {
          is: {
            tempo: { not: null },
            tempoSource: { startsWith: "Aubio" },
          },
        },
      },
    ],
  };
}
