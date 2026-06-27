ALTER TABLE "Track"
  ADD COLUMN "genreStatus" TEXT,
  ADD COLUMN "genreAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "genreFailureReason" TEXT,
  ADD COLUMN "popularityStatus" TEXT,
  ADD COLUMN "popularityAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "popularityFailureReason" TEXT;

CREATE INDEX "Track_libraryId_genreStatus_idx" ON "Track"("libraryId", "genreStatus");
CREATE INDEX "Track_libraryId_popularityStatus_idx" ON "Track"("libraryId", "popularityStatus");
