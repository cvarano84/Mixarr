import type { Prisma } from "@prisma/client";

export const audioFeatureSources = ["api", "local_essentia", "local_heuristic", "mixed"] as const;
export type AudioFeatureSource = typeof audioFeatureSources[number];

export const audioFeatureStatuses = [
  "pending",
  "success",
  "no_data",
  "extraction_failed",
  "analyzer_failed",
  "partial",
] as const;
export type AudioFeatureStatus = typeof audioFeatureStatuses[number];

export type AudioFeatureFilterOptions = {
  includeEstimated?: boolean;
  minimumConfidence?: number | null;
};

export const placeholderAudioFeatureWhere: Prisma.AudioFeatureWhereInput = {
  OR: [
    { source: { in: ["not_found", "estimated", "Deezer BPM only"] } },
    { audioFeatureSource: "local_heuristic", audioFeatureConfidence: { lte: 0 } },
    {
      AND: [
        { energy: 0.5 },
        { valence: 0.5 },
        { danceability: 0.5 },
        {
          OR: [
            { source: { contains: "Unknown Mood", mode: "insensitive" } },
            { source: "estimated" },
            { audioFeatureStatus: "no_data" },
          ],
        },
      ],
    },
  ],
};

export function completeAudioFeatureWhere(): Prisma.AudioFeatureWhereInput {
  return {
    AND: [
      { energy: { not: null } },
      { valence: { not: null } },
      { danceability: { not: null } },
      { tempo: { not: null } },
      { NOT: placeholderAudioFeatureWhere },
      {
        OR: [
          { audioFeatureStatus: { in: ["success", "partial"] } },
          { audioFeatureStatus: null },
        ],
      },
    ],
  };
}

export function completeAudioFeatureTrackWhere(): Prisma.TrackWhereInput {
  return { audioFeature: { is: completeAudioFeatureWhere() } };
}

export function missingAudioFeatureTrackWhere(): Prisma.TrackWhereInput {
  return {
    OR: [
      { audioFeature: null },
      { audioFeature: { is: { NOT: completeAudioFeatureWhere() } } },
    ],
  };
}

export function apiAudioFeatureTrackWhere(): Prisma.TrackWhereInput {
  return {
    audioFeature: {
      is: {
        AND: [
          completeAudioFeatureWhere(),
          {
            OR: [
              { audioFeatureSource: "api" },
              {
                AND: [
                  { audioFeatureSource: null },
                  { source: { notIn: ["not_found", "estimated", "local_not_found"] } },
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

export function localAudioFeatureTrackWhere(): Prisma.TrackWhereInput {
  return {
    audioFeature: {
      is: {
        AND: [
          completeAudioFeatureWhere(),
          { audioFeatureSource: { in: ["local_essentia", "mixed"] } },
        ],
      },
    },
  };
}

export function heuristicAudioFeatureTrackWhere(): Prisma.TrackWhereInput {
  return {
    audioFeature: {
      is: {
        OR: [
          { audioFeatureSource: "local_heuristic" },
          { valenceSource: "local_heuristic" },
          { acousticnessSource: "local_heuristic" },
          { danceabilitySource: "local_heuristic" },
        ],
      },
    },
  };
}

export function partialAudioFeatureTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      { audioFeature: { isNot: null } },
      { NOT: completeAudioFeatureTrackWhere() },
      {
        audioFeature: {
          is: {
            OR: [
              { audioFeatureStatus: "partial" },
              { energy: { not: null } },
              { valence: { not: null } },
              { danceability: { not: null } },
              { acousticness: { not: null } },
              { tempo: { not: null } },
            ],
          },
        },
      },
    ],
  };
}

export function audioFeatureNoDataTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingAudioFeatureTrackWhere(),
      { audioFeature: { is: { audioFeatureStatus: "no_data" } } },
    ],
  };
}

export function audioFeatureExtractionFailedTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingAudioFeatureTrackWhere(),
      { audioFeature: { is: { audioFeatureStatus: "extraction_failed" } } },
    ],
  };
}

export function audioFeatureAnalyzerFailedTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingAudioFeatureTrackWhere(),
      { audioFeature: { is: { audioFeatureStatus: "analyzer_failed" } } },
    ],
  };
}

export function audioFeatureFailedTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingAudioFeatureTrackWhere(),
      {
        OR: [
          audioFeatureExtractionFailedTrackWhere(),
          audioFeatureAnalyzerFailedTrackWhere(),
        ],
      },
    ],
  };
}

export function audioFeatureFilterGuardWhere(
  fieldSource: "energySource" | "valenceSource" | "danceabilitySource" | "acousticnessSource",
  options: AudioFeatureFilterOptions = {},
): Prisma.AudioFeatureWhereInput {
  const and: Prisma.AudioFeatureWhereInput[] = [];
  if (!options.includeEstimated) {
    and.push({ [fieldSource]: { not: "local_heuristic" } } as Prisma.AudioFeatureWhereInput);
  }
  if (typeof options.minimumConfidence === "number" && options.minimumConfidence > 0) {
    and.push({
      OR: [
        { audioFeatureConfidence: { gte: options.minimumConfidence } },
        { audioFeatureConfidence: null },
      ],
    });
  }
  and.push({ NOT: placeholderAudioFeatureWhere });
  return and.length === 1 ? and[0] : { AND: and };
}
