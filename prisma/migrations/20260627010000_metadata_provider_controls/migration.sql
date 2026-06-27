ALTER TABLE "SyncSettings"
  ADD COLUMN "enableApiBpm" BOOLEAN,
  ADD COLUMN "enableLocalBpm" BOOLEAN,
  ADD COLUMN "preferLocalBpm" BOOLEAN,
  ADD COLUMN "reprocessApiBpmWithLocal" BOOLEAN,
  ADD COLUMN "localBpmAnalysisScope" TEXT,
  ADD COLUMN "enableApiAudioFeatures" BOOLEAN,
  ADD COLUMN "enableLocalAudioFeatures" BOOLEAN,
  ADD COLUMN "preferLocalAudioFeatures" BOOLEAN,
  ADD COLUMN "reprocessApiAudioFeaturesWithLocal" BOOLEAN;

ALTER TABLE "Track"
  ADD COLUMN "apiBpm" DOUBLE PRECISION,
  ADD COLUMN "localBpm" DOUBLE PRECISION,
  ADD COLUMN "effectiveBpm" DOUBLE PRECISION,
  ADD COLUMN "bpmAnalysisScope" TEXT;

UPDATE "Track"
SET
  "apiBpm" = CASE
    WHEN "bpmSource" IN ('deezer', 'Deezer', 'api') THEN "bpm"
    ELSE NULL
  END,
  "localBpm" = CASE
    WHEN "bpmSource" IN ('essentia', 'aubio', 'local_essentia') THEN "bpm"
    ELSE NULL
  END,
  "effectiveBpm" = "bpm"
WHERE "bpm" IS NOT NULL;

ALTER TABLE "AudioFeature"
  ADD COLUMN "apiEnergy" DOUBLE PRECISION,
  ADD COLUMN "apiMood" DOUBLE PRECISION,
  ADD COLUMN "apiDanceability" DOUBLE PRECISION,
  ADD COLUMN "apiAcousticness" DOUBLE PRECISION,
  ADD COLUMN "apiLoudness" DOUBLE PRECISION,
  ADD COLUMN "localEnergy" DOUBLE PRECISION,
  ADD COLUMN "localMood" DOUBLE PRECISION,
  ADD COLUMN "localDanceability" DOUBLE PRECISION,
  ADD COLUMN "localAcousticness" DOUBLE PRECISION,
  ADD COLUMN "localLoudness" DOUBLE PRECISION,
  ADD COLUMN "effectiveEnergy" DOUBLE PRECISION,
  ADD COLUMN "effectiveMood" DOUBLE PRECISION,
  ADD COLUMN "effectiveDanceability" DOUBLE PRECISION,
  ADD COLUMN "effectiveAcousticness" DOUBLE PRECISION;

UPDATE "AudioFeature"
SET
  "apiEnergy" = CASE WHEN "audioFeatureSource" = 'api' OR "energySource" = 'api' THEN "energy" ELSE NULL END,
  "apiMood" = CASE WHEN "audioFeatureSource" = 'api' OR "valenceSource" = 'api' THEN "valence" ELSE NULL END,
  "apiDanceability" = CASE WHEN "audioFeatureSource" = 'api' OR "danceabilitySource" = 'api' THEN "danceability" ELSE NULL END,
  "apiAcousticness" = CASE WHEN "audioFeatureSource" = 'api' OR "acousticnessSource" = 'api' THEN "acousticness" ELSE NULL END,
  "apiLoudness" = CASE WHEN "audioFeatureSource" = 'api' THEN "loudness" ELSE NULL END,
  "localEnergy" = CASE WHEN "energySource" = 'local_essentia' THEN "energy" ELSE NULL END,
  "localMood" = CASE WHEN "valenceSource" IN ('local_essentia', 'local_heuristic') THEN "valence" ELSE NULL END,
  "localDanceability" = CASE WHEN "danceabilitySource" IN ('local_essentia', 'local_heuristic') THEN "danceability" ELSE NULL END,
  "localAcousticness" = CASE WHEN "acousticnessSource" IN ('local_essentia', 'local_heuristic') THEN "acousticness" ELSE NULL END,
  "localLoudness" = CASE WHEN "audioFeatureSource" IN ('local_essentia', 'local_heuristic', 'mixed') THEN "loudness" ELSE NULL END,
  "effectiveEnergy" = "energy",
  "effectiveMood" = "valence",
  "effectiveDanceability" = "danceability",
  "effectiveAcousticness" = "acousticness";
