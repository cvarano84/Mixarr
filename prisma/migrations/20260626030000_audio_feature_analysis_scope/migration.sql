ALTER TABLE "SyncSettings"
  ADD COLUMN "localAudioFeaturesScope" TEXT;

ALTER TABLE "AudioFeature"
  ADD COLUMN "audioFeatureAnalysisScope" TEXT;
