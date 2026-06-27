import prisma from "./prisma";

export type SyncEngineOptions = {
  plexPageSize?: number | null;
  popularityBatchSize?: number | null;
  audioFeatureBatchSize?: number | null;
  tagBatchSize?: number | null;
  bpmBatchSize?: number | null;
  bpmReprocessNoDataFailed?: boolean | null;
  enableLocalAudioFeatureFallback?: boolean | null;
  preferApiAudioFeatures?: boolean | null;
  allowEstimatedMoodAcousticness?: boolean | null;
  reprocessLocalAudioFeatures?: boolean | null;
  localAudioFeaturesScope?: string | null;
  includeEstimatedAudioFeaturesInFilters?: boolean | null;
  audioFeatureMinimumConfidence?: number | null;
  providerDelayMs?: number | null;
  rateLimitBackoffEnabled?: boolean | null;
};

export const numericSyncSettingKeys = [
  "plexPageSize",
  "popularityBatchSize",
  "audioFeatureBatchSize",
  "tagBatchSize",
  "bpmBatchSize",
  "providerDelayMs",
  "audioFeatureMinimumConfidence",
] as const;

export const booleanSyncSettingKeys = [
  "bpmReprocessNoDataFailed",
  "enableLocalAudioFeatureFallback",
  "preferApiAudioFeatures",
  "allowEstimatedMoodAcousticness",
  "reprocessLocalAudioFeatures",
  "includeEstimatedAudioFeaturesInFilters",
  "rateLimitBackoffEnabled",
] as const;

export const stringSyncSettingKeys = [
  "localAudioFeaturesScope",
] as const;

export const syncSettingKeys = [
  ...numericSyncSettingKeys,
  ...booleanSyncSettingKeys,
  ...stringSyncSettingKeys,
] as const;

export type SyncSettingKey = typeof syncSettingKeys[number];

export function normalizeOptionalNonNegativeInteger(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

export function normalizeOptionalNonNegativeNumber(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export function normalizeOptionalBoolean(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  return typeof value === "boolean" ? value : null;
}

export function normalizeOptionalString(value: unknown, allowedValues: readonly string[]) {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return allowedValues.includes(normalized) ? normalized : null;
}

export function resolveLimit(userValue: number | null | undefined, envName: string) {
  if (typeof userValue === "number" && userValue > 0) return userValue;
  const envValue = process.env[envName];
  if (!envValue) return undefined;
  const parsed = Number(envValue);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolveDelayMs(userValue: number | null | undefined, fallbackMs: number) {
  if (typeof userValue === "number" && userValue >= 0) return userValue;
  return fallbackMs;
}

export function resolveRateLimitBackoff(userValue: boolean | null | undefined) {
  return userValue !== false;
}

export async function getUserSyncSettings(userId: string): Promise<SyncEngineOptions> {
  const settings = await prisma.syncSettings.findUnique({
    where: { userId },
    select: {
      plexPageSize: true,
      popularityBatchSize: true,
      audioFeatureBatchSize: true,
      tagBatchSize: true,
      bpmBatchSize: true,
      bpmReprocessNoDataFailed: true,
      enableLocalAudioFeatureFallback: true,
      preferApiAudioFeatures: true,
      allowEstimatedMoodAcousticness: true,
      reprocessLocalAudioFeatures: true,
      localAudioFeaturesScope: true,
      includeEstimatedAudioFeaturesInFilters: true,
      audioFeatureMinimumConfidence: true,
      providerDelayMs: true,
      rateLimitBackoffEnabled: true,
    },
  });

  return settings || {};
}
