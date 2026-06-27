import prisma from "./prisma";

export type SyncEngineOptions = {
  plexPageSize?: number | null;
  popularityBatchSize?: number | null;
  audioFeatureBatchSize?: number | null;
  tagBatchSize?: number | null;
  bpmBatchSize?: number | null;
  bpmReprocessNoDataFailed?: boolean | null;
  enableApiBpm?: boolean | null;
  enableLocalBpm?: boolean | null;
  preferLocalBpm?: boolean | null;
  reprocessApiBpmWithLocal?: boolean | null;
  localBpmAnalysisScope?: string | null;
  enableApiAudioFeatures?: boolean | null;
  enableLocalAudioFeatures?: boolean | null;
  preferLocalAudioFeatures?: boolean | null;
  reprocessApiAudioFeaturesWithLocal?: boolean | null;
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
  "enableApiBpm",
  "enableLocalBpm",
  "preferLocalBpm",
  "reprocessApiBpmWithLocal",
  "enableApiAudioFeatures",
  "enableLocalAudioFeatures",
  "preferLocalAudioFeatures",
  "reprocessApiAudioFeaturesWithLocal",
  "enableLocalAudioFeatureFallback",
  "preferApiAudioFeatures",
  "allowEstimatedMoodAcousticness",
  "reprocessLocalAudioFeatures",
  "includeEstimatedAudioFeaturesInFilters",
  "rateLimitBackoffEnabled",
] as const;

export const stringSyncSettingKeys = [
  "localBpmAnalysisScope",
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

export type MetadataAnalysisScope = "windows" | "whole_track";

function envBoolean(envName: string, defaultValue: boolean) {
  const envValue = process.env[envName];
  if (envValue === undefined) return defaultValue;
  const normalized = envValue.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

export function normalizeMetadataAnalysisScope(value: unknown): MetadataAnalysisScope {
  return String(value || "windows").trim().toLowerCase() === "whole_track" ? "whole_track" : "windows";
}

function resolveBooleanSetting(userValue: boolean | null | undefined, envName: string, defaultValue: boolean) {
  return typeof userValue === "boolean" ? userValue : envBoolean(envName, defaultValue);
}

function resolveScopeSetting(userValue: string | null | undefined, envName: string) {
  return normalizeMetadataAnalysisScope(userValue ?? process.env[envName]);
}

export function resolveMetadataProviderSettings(options: SyncEngineOptions = {}) {
  const enableApiBpm = resolveBooleanSetting(options.enableApiBpm, "ENABLE_API_BPM", true);
  const enableLocalBpm = resolveBooleanSetting(options.enableLocalBpm, "ENABLE_LOCAL_BPM", true);
  const preferLocalBpm = resolveBooleanSetting(options.preferLocalBpm, "PREFER_LOCAL_BPM", false);
  const reprocessApiBpmWithLocal = resolveBooleanSetting(options.reprocessApiBpmWithLocal, "REPROCESS_API_BPM_WITH_LOCAL", false);
  const localBpmAnalysisScope = resolveScopeSetting(options.localBpmAnalysisScope, "LOCAL_BPM_ANALYSIS_SCOPE");

  const enableApiAudioFeatures = resolveBooleanSetting(options.enableApiAudioFeatures, "ENABLE_API_AUDIO_FEATURES", true);
  const legacyLocalAudioEnabled = options.enableLocalAudioFeatures ?? options.enableLocalAudioFeatureFallback;
  const enableLocalAudioFeatures = resolveBooleanSetting(legacyLocalAudioEnabled, "ENABLE_LOCAL_AUDIO_FEATURES", true);
  const preferLocalAudioFeatures = resolveBooleanSetting(options.preferLocalAudioFeatures, "PREFER_LOCAL_AUDIO_FEATURES", false);
  const reprocessApiAudioFeaturesWithLocal = resolveBooleanSetting(
    options.reprocessApiAudioFeaturesWithLocal,
    "REPROCESS_API_AUDIO_FEATURES_WITH_LOCAL",
    false,
  );
  const localAudioFeaturesScope = resolveScopeSetting(options.localAudioFeaturesScope, "LOCAL_AUDIO_FEATURES_SCOPE");
  const allowEstimatedAudioFeatures = resolveBooleanSetting(
    options.allowEstimatedMoodAcousticness,
    "ALLOW_ESTIMATED_AUDIO_FEATURES",
    true,
  );

  return {
    bpm: {
      api: enableApiBpm,
      local: enableLocalBpm,
      preferLocal: preferLocalBpm,
      reprocessApiWithLocal: reprocessApiBpmWithLocal,
      scope: localBpmAnalysisScope,
    },
    audioFeatures: {
      api: enableApiAudioFeatures,
      local: enableLocalAudioFeatures,
      preferLocal: preferLocalAudioFeatures,
      reprocessApiWithLocal: reprocessApiAudioFeaturesWithLocal,
      scope: localAudioFeaturesScope,
      allowEstimated: allowEstimatedAudioFeatures,
    },
  };
}

export function metadataProviderModeLabel(config: ReturnType<typeof resolveMetadataProviderSettings>["bpm" | "audioFeatures"]) {
  if (!config.api && !config.local) return "Disabled";
  if (config.api && config.local) return `API + Local, ${config.preferLocal ? "Local" : "API"} preferred`;
  if (config.api) return "API enabled, local disabled";
  return "Local enabled, API disabled";
}

export function logMetadataProviderSettings(options: SyncEngineOptions = {}) {
  const settings = resolveMetadataProviderSettings(options);
  console.log(
    `[MetadataSettings] BPM providers: api=${settings.bpm.api} local=${settings.bpm.local} preferLocal=${settings.bpm.preferLocal} reprocessApi=${settings.bpm.reprocessApiWithLocal} scope=${settings.bpm.scope}`,
  );
  console.log(
    `[MetadataSettings] Audio feature providers: api=${settings.audioFeatures.api} local=${settings.audioFeatures.local} preferLocal=${settings.audioFeatures.preferLocal} reprocessApi=${settings.audioFeatures.reprocessApiWithLocal} scope=${settings.audioFeatures.scope}`,
  );
  return settings;
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
      enableApiBpm: true,
      enableLocalBpm: true,
      preferLocalBpm: true,
      reprocessApiBpmWithLocal: true,
      localBpmAnalysisScope: true,
      enableApiAudioFeatures: true,
      enableLocalAudioFeatures: true,
      preferLocalAudioFeatures: true,
      reprocessApiAudioFeaturesWithLocal: true,
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
