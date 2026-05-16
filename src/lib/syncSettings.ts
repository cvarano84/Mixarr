import prisma from "./prisma";

export type SyncEngineOptions = {
  plexPageSize?: number | null;
  popularityBatchSize?: number | null;
  audioFeatureBatchSize?: number | null;
  tagBatchSize?: number | null;
  bpmBatchSize?: number | null;
  providerDelayMs?: number | null;
};

export const syncSettingKeys = [
  "plexPageSize",
  "popularityBatchSize",
  "audioFeatureBatchSize",
  "tagBatchSize",
  "bpmBatchSize",
  "providerDelayMs",
] as const;

export type SyncSettingKey = typeof syncSettingKeys[number];

export function normalizeOptionalNonNegativeInteger(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
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

export async function getUserSyncSettings(userId: string): Promise<SyncEngineOptions> {
  const settings = await prisma.syncSettings.findUnique({
    where: { userId },
    select: {
      plexPageSize: true,
      popularityBatchSize: true,
      audioFeatureBatchSize: true,
      tagBatchSize: true,
      bpmBatchSize: true,
      providerDelayMs: true,
    },
  });

  return settings || {};
}
