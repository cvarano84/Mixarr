import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTrackWhereClause, playlistConfigSchema } from "./playlistService";
import { activeSyncStatusWhere } from "./syncStatus";
import { reconcileCompletedLibrary, seenSyncData } from "./syncEngine";

function transactionDouble() {
  const calls = {
    trackUpdates: [] as any[],
    albumUpdates: [] as any[],
    artistUpdates: [] as any[],
  };
  return {
    calls,
    track: {
      updateMany: async (args: any) => { calls.trackUpdates.push(args); return { count: 41 }; },
      deleteMany: async () => ({ count: 0 }),
      count: async () => 33_137,
    },
    album: { updateMany: async (args: any) => { calls.albumUpdates.push(args); return { count: 2 }; } },
    artist: { updateMany: async (args: any) => { calls.artistUpdates.push(args); return { count: 1 }; } },
  };
}

describe("Plex library reconciliation", () => {
  it("marks active tracks not seen in the completed run as missing", async () => {
    const tx = transactionDouble();
    const seenAt = new Date("2026-06-22T12:00:00Z");

    const result = await reconcileCompletedLibrary(tx, {
      libraryId: "library-a",
      syncRunId: "sync-2",
      seenAt,
      snapshotComplete: true,
    });

    assert.deepEqual(tx.calls.trackUpdates, [{
      where: {
        libraryId: "library-a",
        syncStatus: "active",
        OR: [{ lastSeenSyncId: null }, { lastSeenSyncId: { not: "sync-2" } }],
      },
      data: { syncStatus: "missing", missingSince: seenAt },
    }]);
    assert.equal(result.markedMissing, 41);
    assert.equal(result.activeDashboardCount, 33_137);
  });

  it("restores a seen item to active and clears missing/deleted timestamps", () => {
    const seenAt = new Date("2026-06-22T12:00:00Z");
    assert.deepEqual(seenSyncData("sync-3", seenAt, "plex-section-4"), {
      plexLibraryId: "plex-section-4",
      syncStatus: "active",
      lastSeenAt: seenAt,
      lastSeenSyncId: "sync-3",
      missingSince: null,
      deletedAt: null,
    });
  });

  it("does not mutate records for an incomplete or failed snapshot", async () => {
    const tx = transactionDouble();

    await assert.rejects(
      reconcileCompletedLibrary(tx, {
        libraryId: "library-a",
        syncRunId: "sync-failed",
        seenAt: new Date(),
        snapshotComplete: false,
      }),
      /reconciliation skipped/,
    );

    assert.equal(tx.calls.trackUpdates.length, 0);
    assert.equal(tx.calls.albumUpdates.length, 0);
    assert.equal(tx.calls.artistUpdates.length, 0);
  });

  it("defines dashboard counts as active-only", () => {
    assert.deepEqual(activeSyncStatusWhere(), { syncStatus: "active" });
  });

  it("excludes missing and deleted tracks from playlist generation", () => {
    const config = playlistConfigSchema.parse({ rules: [], limit: 50 });
    const where = buildTrackWhereClause("user-a", config);
    assert.ok(where.AND.some((condition: any) => condition.syncStatus === "active"));
  });

  it("uses the safe playlist default when the UI submits limit zero", () => {
    const config = playlistConfigSchema.parse({ rules: [], limit: 0 });
    assert.equal(config.limit, 100);
  });
});
