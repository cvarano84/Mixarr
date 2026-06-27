ALTER TABLE "SyncLog"
  ADD COLUMN "reconciliationAt" TIMESTAMP(3),
  ADD COLUMN "snapshotComplete" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "plexReportedTrackCount" INTEGER;

CREATE INDEX "SyncLog_libraryId_startedAt_idx" ON "SyncLog"("libraryId", "startedAt");
