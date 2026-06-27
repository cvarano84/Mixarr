export const ACTIVE_SYNC_STATUS = "active" as const;

export function activeSyncStatusWhere() {
  return { syncStatus: ACTIVE_SYNC_STATUS };
}
