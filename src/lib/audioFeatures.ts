import type { Prisma } from "@prisma/client";

export const audioFeatureSources = ["api", "local_essentia", "local_heuristic", "mixed"] as const;
export type AudioFeatureSource = typeof audioFeatureSources[number];

export const audioFeatureStatuses = [
  "pending",
  "success",
  "no_data",
  "extraction_failed",
  "analyzer_failed",
  "too_short",
  "partial",
] as const;
export type AudioFeatureStatus = typeof audioFeatureStatuses[number];

export type AudioFeatureFilterOptions = {
  includeEstimated?: boolean;
  minimumConfidence?: number | null;
};

export type EffectiveAudioFeatureSettings = {
  preferLocalAudioFeatures?: boolean;
  preferLocal?: boolean;
  allowEstimated?: boolean;
  tempoRequired?: boolean;
};

export type EffectiveAudioFeatures = {
  energy: number | null;
  mood: number | null;
  valence: number | null;
  danceability: number | null;
  acousticness: number | null;
  tempo: number | null;
  source: AudioFeatureSource | null;
  status: AudioFeatureStatus | null;
  confidence: number | null;
  complete: boolean;
  partial: boolean;
  missingFields: string[];
};

const failedAudioFeatureStatuses = ["pending", "no_data", "extraction_failed", "analyzer_failed", "too_short"] as const;
const audioFeatureFields = ["energy", "mood", "danceability", "acousticness"] as const;
const invalidCompleteAudioFeatureStatuses = ["pending", "no_data", "extraction_failed", "analyzer_failed", "too_short"] as const;

function validUnitValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
}

function validTempoValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function featureFromTrack(trackOrFeature: any) {
  return trackOrFeature?.audioFeature ?? trackOrFeature ?? null;
}

function sourceIsPlaceholder(source: unknown) {
  const normalized = String(source || "").trim().toLowerCase();
  return !normalized
    || ["not_found", "estimated", "deezer bpm only", "local_not_found"].includes(normalized)
    || normalized.includes("unknown mood");
}

function statusAllowsFeatureValues(status: unknown) {
  if (!status) return true;
  return !failedAudioFeatureStatuses.includes(status as any);
}

function isLocalEssentiaFeature(feature: any) {
  const source = String(feature?.source || "").toLowerCase();
  const tempoSource = String(feature?.tempoSource || "").toLowerCase();
  return feature?.audioFeatureSource === "local_essentia"
    || feature?.audioFeatureSource === "mixed"
    || feature?.energySource === "local_essentia"
    || feature?.valenceSource === "local_essentia"
    || feature?.danceabilitySource === "local_essentia"
    || feature?.acousticnessSource === "local_essentia"
    || source.includes("essentia local")
    || tempoSource.includes("essentia local");
}

function isApiFeature(feature: any) {
  return feature?.audioFeatureSource === "api"
    || feature?.audioFeatureSource === "mixed"
    || feature?.energySource === "api"
    || feature?.valenceSource === "api"
    || feature?.danceabilitySource === "api"
    || feature?.acousticnessSource === "api"
    || feature?.apiEnergy !== null && feature?.apiEnergy !== undefined
    || feature?.apiMood !== null && feature?.apiMood !== undefined
    || feature?.apiDanceability !== null && feature?.apiDanceability !== undefined
    || feature?.apiAcousticness !== null && feature?.apiAcousticness !== undefined;
}

function isAllowedHeuristicFeature(feature: any, allowEstimated: boolean) {
  if (!allowEstimated) return false;
  if (!statusAllowsFeatureValues(feature?.audioFeatureStatus)) return false;
  if (Number(feature?.audioFeatureConfidence ?? feature?.confidence ?? 0) <= 0) return false;
  return feature?.audioFeatureSource === "local_heuristic"
    || feature?.valenceSource === "local_heuristic"
    || feature?.danceabilitySource === "local_heuristic"
    || feature?.acousticnessSource === "local_heuristic";
}

function chooseFirstValidUnit(...values: unknown[]) {
  for (const value of values) {
    const valid = validUnitValue(value);
    if (valid !== null) return valid;
  }
  return null;
}

export function getEffectiveAudioFeatures(trackOrFeature: any, settings: EffectiveAudioFeatureSettings = {}): EffectiveAudioFeatures {
  const feature = featureFromTrack(trackOrFeature);
  const preferLocal = settings.preferLocalAudioFeatures ?? settings.preferLocal ?? false;
  const allowEstimated = settings.allowEstimated ?? true;
  const tempoRequired = settings.tempoRequired ?? true;
  if (!feature) {
    const missingFields = tempoRequired ? [...audioFeatureFields, "tempo"] : [...audioFeatureFields];
    return {
      energy: null,
      mood: null,
      valence: null,
      danceability: null,
      acousticness: null,
      tempo: null,
      source: null,
      status: null,
      confidence: null,
      complete: false,
      partial: false,
      missingFields,
    };
  }

  const status = (audioFeatureStatuses as readonly string[]).includes(feature.audioFeatureStatus)
    ? feature.audioFeatureStatus as AudioFeatureStatus
    : null;
  const source = (audioFeatureSources as readonly string[]).includes(feature.audioFeatureSource)
    ? feature.audioFeatureSource as AudioFeatureSource
    : null;
  const sourceUsable = !sourceIsPlaceholder(feature.source) || source !== null || status === "success";
  const statusUsable = statusAllowsFeatureValues(status);
  const localUsable = statusUsable && isLocalEssentiaFeature(feature);
  const apiUsable = statusUsable && sourceUsable && isApiFeature(feature);
  const heuristicUsable = sourceUsable && isAllowedHeuristicFeature(feature, allowEstimated);

  const local = {
    energy: localUsable ? validUnitValue(feature.localEnergy ?? (feature.energySource === "local_essentia" ? feature.energy : null)) : null,
    mood: localUsable ? validUnitValue(feature.localMood ?? (feature.valenceSource === "local_essentia" ? feature.valence : null)) : null,
    danceability: localUsable ? validUnitValue(feature.localDanceability ?? (feature.danceabilitySource === "local_essentia" ? feature.danceability : null)) : null,
    acousticness: localUsable ? validUnitValue(feature.localAcousticness ?? (feature.acousticnessSource === "local_essentia" ? feature.acousticness : null)) : null,
    tempo: localUsable ? validTempoValue(feature.tempo) : null,
  };
  const api = {
    energy: apiUsable ? validUnitValue(feature.apiEnergy ?? (feature.energySource === "api" ? feature.energy : null)) : null,
    mood: apiUsable ? validUnitValue(feature.apiMood ?? (feature.valenceSource === "api" ? feature.valence : null)) : null,
    danceability: apiUsable ? validUnitValue(feature.apiDanceability ?? (feature.danceabilitySource === "api" ? feature.danceability : null)) : null,
    acousticness: apiUsable ? validUnitValue(feature.apiAcousticness ?? (feature.acousticnessSource === "api" ? feature.acousticness : null)) : null,
    tempo: apiUsable ? validTempoValue(feature.tempo) : null,
  };
  const heuristic = {
    energy: heuristicUsable ? validUnitValue(feature.energy) : null,
    mood: heuristicUsable ? validUnitValue(feature.localMood ?? feature.valence) : null,
    danceability: heuristicUsable ? validUnitValue(feature.localDanceability ?? feature.danceability) : null,
    acousticness: heuristicUsable ? validUnitValue(feature.localAcousticness ?? feature.acousticness) : null,
    tempo: heuristicUsable ? validTempoValue(feature.tempo) : null,
  };
  const final = statusUsable && sourceUsable ? {
    energy: validUnitValue(feature.effectiveEnergy ?? feature.energy),
    mood: validUnitValue(feature.effectiveMood ?? feature.valence),
    danceability: validUnitValue(feature.effectiveDanceability ?? feature.danceability),
    acousticness: validUnitValue(feature.effectiveAcousticness ?? feature.acousticness),
    tempo: validTempoValue(feature.tempo),
  } : { energy: null, mood: null, danceability: null, acousticness: null, tempo: null };
  const priority = preferLocal ? [local, api, heuristic, final] : [api, local, heuristic, final];
  const selected = {
    energy: chooseFirstValidUnit(...priority.map((candidate) => candidate.energy)),
    mood: chooseFirstValidUnit(...priority.map((candidate) => candidate.mood)),
    danceability: chooseFirstValidUnit(...priority.map((candidate) => candidate.danceability)),
    acousticness: chooseFirstValidUnit(...priority.map((candidate) => candidate.acousticness)),
    tempo: (() => {
      for (const candidate of priority) {
        if (candidate.tempo !== null) return candidate.tempo;
      }
      return null;
    })(),
  };
  const missingFields = [
    selected.energy === null ? "energy" : null,
    selected.mood === null ? "mood" : null,
    selected.danceability === null ? "danceability" : null,
    selected.acousticness === null ? "acousticness" : null,
    tempoRequired && selected.tempo === null ? "tempo" : null,
  ].filter((field): field is string => field !== null);
  const hasAny = [selected.energy, selected.mood, selected.danceability, selected.acousticness, selected.tempo]
    .some((value) => value !== null);
  const complete = missingFields.length === 0
    && statusUsable
    && (source !== "local_heuristic" || heuristicUsable);

  return {
    energy: selected.energy,
    mood: selected.mood,
    valence: selected.mood,
    danceability: selected.danceability,
    acousticness: selected.acousticness,
    tempo: selected.tempo,
    source,
    status,
    confidence: Number.isFinite(Number(feature.audioFeatureConfidence ?? feature.confidence))
      ? Number(feature.audioFeatureConfidence ?? feature.confidence)
      : null,
    complete,
    partial: hasAny && !complete,
    missingFields,
  };
}

export function hasCompleteEffectiveAudioFeatures(trackOrFeature: any, settings: EffectiveAudioFeatureSettings = {}) {
  return getEffectiveAudioFeatures(trackOrFeature, settings).complete;
}

const placeholderSources = ["not_found", "estimated", "Deezer BPM only"] as const;

export const placeholderAudioFeatureWhere: Prisma.AudioFeatureWhereInput = {
  OR: [
    { source: { in: [...placeholderSources] } },
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

// Null-safe negation of placeholderAudioFeatureWhere: TRUE unless the row is *definitely* a
// placeholder. We spell out NOT-each-disjunct positively (with explicit IS NULL escapes)
// because Prisma compiles { NOT: placeholderAudioFeatureWhere } over the nullable source /
// audioFeatureSource columns to a NULL-propagating predicate, which wrongly drops genuinely
// complete rows (e.g. Deezer-sourced final values with audioFeatureSource NULL) out of
// completeAudioFeatureWhere(). The SQL side uses `(placeholder) IS NOT TRUE` for the same reason.
export const nonPlaceholderAudioFeatureWhere: Prisma.AudioFeatureWhereInput = {
  AND: [
    // NOT (source in placeholder sources)
    { OR: [{ source: null }, { source: { notIn: [...placeholderSources] } }] },
    // NOT (local_heuristic AND confidence <= 0)
    {
      OR: [
        { audioFeatureSource: null },
        { audioFeatureSource: { not: "local_heuristic" } },
        { audioFeatureConfidence: null },
        { audioFeatureConfidence: { gt: 0 } },
      ],
    },
    // NOT (0.5/0.5/0.5 neutral triple carrying an unknown-mood / estimated / no_data marker)
    {
      OR: [
        { energy: null }, { energy: { not: 0.5 } },
        { valence: null }, { valence: { not: 0.5 } },
        { danceability: null }, { danceability: { not: 0.5 } },
        {
          AND: [
            { OR: [{ source: null }, { NOT: { source: { contains: "Unknown Mood", mode: "insensitive" } } }] },
            { OR: [{ source: null }, { source: { not: "estimated" } }] },
            { OR: [{ audioFeatureStatus: null }, { audioFeatureStatus: { not: "no_data" } }] },
          ],
        },
      ],
    },
  ],
};

const usableCompleteAudioFeatureStatusWhere: Prisma.AudioFeatureWhereInput = {
  OR: [
    { audioFeatureStatus: null },
    { audioFeatureStatus: { notIn: [...invalidCompleteAudioFeatureStatuses] } },
  ],
};

const validFinalAudioFeatureFieldsWhere: Prisma.AudioFeatureWhereInput = {
  AND: [
    { energy: { gte: 0, lte: 1 } },
    { valence: { gte: 0, lte: 1 } },
    { danceability: { gte: 0, lte: 1 } },
    { acousticness: { gte: 0, lte: 1 } },
    { tempo: { gt: 0 } },
  ],
};

const validApiAudioFeatureFieldsWhere: Prisma.AudioFeatureWhereInput = {
  AND: [
    { apiEnergy: { gte: 0, lte: 1 } },
    { apiMood: { gte: 0, lte: 1 } },
    { apiDanceability: { gte: 0, lte: 1 } },
    { apiAcousticness: { gte: 0, lte: 1 } },
    { tempo: { gt: 0 } },
  ],
};

const validLocalAudioFeatureFieldsWhere: Prisma.AudioFeatureWhereInput = {
  AND: [
    { localEnergy: { gte: 0, lte: 1 } },
    { localMood: { gte: 0, lte: 1 } },
    { localDanceability: { gte: 0, lte: 1 } },
    { localAcousticness: { gte: 0, lte: 1 } },
    { tempo: { gt: 0 } },
  ],
};

const localEssentiaAudioFeatureMarkerWhere: Prisma.AudioFeatureWhereInput = {
  OR: [
    { audioFeatureSource: { in: ["local_essentia", "mixed"] } },
    { energySource: "local_essentia" },
    { valenceSource: "local_essentia" },
    { danceabilitySource: "local_essentia" },
    { acousticnessSource: "local_essentia" },
    { localEnergy: { not: null } },
    { localMood: { not: null } },
    { localDanceability: { not: null } },
    { localAcousticness: { not: null } },
  ],
};

const apiAudioFeatureMarkerWhere: Prisma.AudioFeatureWhereInput = {
  OR: [
    { audioFeatureSource: { in: ["api", "mixed"] } },
    { energySource: "api" },
    { valenceSource: "api" },
    { danceabilitySource: "api" },
    { acousticnessSource: "api" },
    { apiEnergy: { not: null } },
    { apiMood: { not: null } },
    { apiDanceability: { not: null } },
    { apiAcousticness: { not: null } },
  ],
};

export function completeAudioFeatureWhere(): Prisma.AudioFeatureWhereInput {
  return {
    AND: [
      usableCompleteAudioFeatureStatusWhere,
      {
        OR: [
          { AND: [validLocalAudioFeatureFieldsWhere, localEssentiaAudioFeatureMarkerWhere] },
          { AND: [validApiAudioFeatureFieldsWhere, apiAudioFeatureMarkerWhere, nonPlaceholderAudioFeatureWhere] },
          { AND: [validFinalAudioFeatureFieldsWhere, nonPlaceholderAudioFeatureWhere] },
        ],
      },
    ],
  };
}

export function completeAudioFeatureTrackWhere(): Prisma.TrackWhereInput {
  return { audioFeature: { is: completeAudioFeatureWhere() } };
}

// A unit-range field (0..1) is "not valid" when it is NULL or outside the range.
// We spell this out positively (rather than NOT { gte, lte }) so it stays a definite
// boolean even for NULL columns - a NOT over a nullable column evaluates to SQL NULL,
// which is exactly the trap that stranded not_found / placeholder rows from backfill.
function invalidUnitFieldWhere(field: keyof Prisma.AudioFeatureWhereInput): Prisma.AudioFeatureWhereInput {
  return { OR: [{ [field]: null }, { [field]: { lt: 0 } }, { [field]: { gt: 1 } }] } as Prisma.AudioFeatureWhereInput;
}

const invalidTempoWhere: Prisma.AudioFeatureWhereInput = { OR: [{ tempo: null }, { tempo: { lte: 0 } }] };

// Each source group is complete only if all of its unit fields are valid and tempo > 0.
// Valid fields imply the group's source marker (a non-null localEnergy is itself a marker),
// so "group not complete" reduces to "some field invalid" - no marker negation needed.
const localGroupIncompleteWhere: Prisma.AudioFeatureWhereInput = {
  OR: [
    invalidUnitFieldWhere("localEnergy"),
    invalidUnitFieldWhere("localMood"),
    invalidUnitFieldWhere("localDanceability"),
    invalidUnitFieldWhere("localAcousticness"),
    invalidTempoWhere,
  ],
};
const apiGroupIncompleteWhere: Prisma.AudioFeatureWhereInput = {
  OR: [
    invalidUnitFieldWhere("apiEnergy"),
    invalidUnitFieldWhere("apiMood"),
    invalidUnitFieldWhere("apiDanceability"),
    invalidUnitFieldWhere("apiAcousticness"),
    invalidTempoWhere,
  ],
};
const finalGroupIncompleteWhere: Prisma.AudioFeatureWhereInput = {
  OR: [
    invalidUnitFieldWhere("energy"),
    invalidUnitFieldWhere("valence"),
    invalidUnitFieldWhere("danceability"),
    invalidUnitFieldWhere("acousticness"),
    invalidTempoWhere,
  ],
};

// The exact, null-safe complement of completeAudioFeatureWhere() on an existing af row.
// complete = statusUsable AND (local OR api OR final); api/final also require NOT placeholder.
// Negating that (and folding in that valid fields imply the marker) gives:
//   statusInvalid
//   OR (localIncomplete AND placeholder)
//   OR (localIncomplete AND apiIncomplete AND finalIncomplete)
// Every leaf is a positive predicate, so it never evaluates to SQL NULL.
export function incompleteAudioFeatureWhere(): Prisma.AudioFeatureWhereInput {
  return {
    OR: [
      { audioFeatureStatus: { in: [...invalidCompleteAudioFeatureStatuses] } },
      { AND: [localGroupIncompleteWhere, placeholderAudioFeatureWhere] },
      { AND: [localGroupIncompleteWhere, apiGroupIncompleteWhere, finalGroupIncompleteWhere] },
    ],
  };
}

export function missingAudioFeatureTrackWhere(): Prisma.TrackWhereInput {
  // A track is missing audio features when it has no AudioFeature row, or its row is
  // not complete. We can't express the second half as NOT(row is complete): Prisma
  // compiles a negated to-one relation filter to a LEFT JOIN whose nullable columns
  // propagate SQL NULL under NOT, so rows with a partial row (not_found markers, 0.5
  // placeholders) silently drop out. Instead we match the incompleteness positively
  // via incompleteAudioFeatureWhere(), which compiles to EXISTS(...) and is null-safe.
  return {
    OR: [
      { audioFeature: null },
      { audioFeature: { is: incompleteAudioFeatureWhere() } },
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
              { apiEnergy: { not: null } },
              { apiMood: { not: null } },
              { apiDanceability: { not: null } },
              { apiAcousticness: { not: null } },
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
          {
            OR: [
              { localEnergy: { not: null } },
              { localMood: { not: null } },
              { localDanceability: { not: null } },
              { localAcousticness: { not: null } },
              { audioFeatureSource: { in: ["local_essentia", "mixed"] } },
            ],
          },
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
          { localMood: { not: null } },
          { localDanceability: { not: null } },
          { localAcousticness: { not: null } },
        ],
      },
    },
  };
}

export function partialAudioFeatureTrackWhere(): Prisma.TrackWhereInput {
  // A partial row exists, is not complete, and carries at least one feature value. We match
  // incompleteness via the positive incompleteAudioFeatureWhere() inside a single `is` (so it
  // compiles to EXISTS and stays null-safe) instead of { NOT: completeAudioFeatureTrackWhere() },
  // whose relation-level NOT drops rows with NULL feature columns.
  return {
    audioFeature: {
      is: {
        AND: [
          incompleteAudioFeatureWhere(),
          {
            OR: [
              { audioFeatureStatus: "partial" },
              { energy: { not: null } },
              { valence: { not: null } },
              { danceability: { not: null } },
              { acousticness: { not: null } },
              { tempo: { not: null } },
              { localEnergy: { not: null } },
              { localMood: { not: null } },
              { localDanceability: { not: null } },
              { localAcousticness: { not: null } },
              { apiEnergy: { not: null } },
              { apiMood: { not: null } },
              { apiDanceability: { not: null } },
              { apiAcousticness: { not: null } },
            ],
          },
        ],
      },
    },
  };
}

export function localEssentiaAudioFeatureSuccessWhere(analysisScope?: string | null): Prisma.AudioFeatureWhereInput {
  return {
    AND: [
      completeAudioFeatureWhere(),
      { audioFeatureStatus: "success" },
      ...(analysisScope ? [{ audioFeatureAnalysisScope: analysisScope }] : []),
      localEssentiaAudioFeatureMarkerWhere,
    ],
  };
}

export function localEssentiaAudioFeatureSuccessTrackWhere(analysisScope?: string | null): Prisma.TrackWhereInput {
  return { audioFeature: { is: localEssentiaAudioFeatureSuccessWhere(analysisScope) } };
}

export function audioFeatureRetryEligibilityTrackWhere(options: {
  force?: boolean;
  providerMode?: "configured" | "api_only" | "local_only" | "force_local";
  analysisScope?: string | null;
} = {}): Prisma.TrackWhereInput {
  if (options.force || options.providerMode === "force_local") return {};

  return {
    AND: [
      missingAudioFeatureTrackWhere(),
      { NOT: localEssentiaAudioFeatureSuccessTrackWhere(options.analysisScope) },
      { NOT: audioFeatureTooShortTrackWhere() },
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

export function audioFeatureTooShortTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingAudioFeatureTrackWhere(),
      { audioFeature: { is: { audioFeatureStatus: "too_short" } } },
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
