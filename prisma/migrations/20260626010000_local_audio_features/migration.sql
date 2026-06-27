ALTER TABLE "SyncSettings"
  ADD COLUMN "enableLocalAudioFeatureFallback" BOOLEAN,
  ADD COLUMN "preferApiAudioFeatures" BOOLEAN,
  ADD COLUMN "allowEstimatedMoodAcousticness" BOOLEAN,
  ADD COLUMN "reprocessLocalAudioFeatures" BOOLEAN,
  ADD COLUMN "includeEstimatedAudioFeaturesInFilters" BOOLEAN,
  ADD COLUMN "audioFeatureMinimumConfidence" DOUBLE PRECISION;

ALTER TABLE "AudioFeature"
  ADD COLUMN "acousticness" DOUBLE PRECISION,
  ADD COLUMN "loudness" DOUBLE PRECISION,
  ADD COLUMN "dynamicComplexity" DOUBLE PRECISION,
  ADD COLUMN "key" TEXT,
  ADD COLUMN "scale" TEXT,
  ADD COLUMN "spectralCentroid" DOUBLE PRECISION,
  ADD COLUMN "spectralContrast" DOUBLE PRECISION,
  ADD COLUMN "rhythmStability" DOUBLE PRECISION,
  ADD COLUMN "onsetRate" DOUBLE PRECISION,
  ADD COLUMN "zeroCrossingRate" DOUBLE PRECISION,
  ADD COLUMN "replayGain" DOUBLE PRECISION,
  ADD COLUMN "audioFeatureSource" TEXT,
  ADD COLUMN "audioFeatureStatus" TEXT,
  ADD COLUMN "audioFeatureConfidence" DOUBLE PRECISION,
  ADD COLUMN "audioFeatureAnalyzedAt" TIMESTAMP(3),
  ADD COLUMN "audioFeatureFailureReason" TEXT,
  ADD COLUMN "energySource" TEXT,
  ADD COLUMN "valenceSource" TEXT,
  ADD COLUMN "danceabilitySource" TEXT,
  ADD COLUMN "acousticnessSource" TEXT;
