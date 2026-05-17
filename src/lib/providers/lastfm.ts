import axios from "axios";
import {
  lastfmAutocorrectionsTotal,
  providerRequestDurationSeconds,
  providerRequestsTotal,
} from "../metrics";

// See note in audiodb.ts.
const REQUEST_TIMEOUT_MS = 15_000;

const PROVIDER = "lastfm";

type Outcome = "success" | "not_found" | "timeout" | "rate_limited" | "error";

function classifyError(error: any): "timeout" | "rate_limited" | "error" {
  if (error?.code === "ECONNABORTED") return "timeout";
  if (error?.response?.status === 429) return "rate_limited";
  return "error";
}

const isAutocorrectEnabled = () => {
  const value = process.env.LASTFM_AUTOCORRECT?.toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
};

const buildTrackParams = (apiKey: string, artist: string, track: string) => {
  const params: Record<string, string> = {
    method: "track.getInfo",
    api_key: apiKey,
    artist,
    track,
    format: "json",
  };

  if (isAutocorrectEnabled()) {
    params.autocorrect = "1";
  }

  return params;
};

const logAutocorrect = (artist: string, track: string, responseTrack: any) => {
  if (!isAutocorrectEnabled() || !responseTrack) return;

  const correctedArtist = typeof responseTrack.artist?.name === "string"
    ? responseTrack.artist.name.trim()
    : typeof responseTrack.artist === "string"
    ? responseTrack.artist.trim()
    : "";
  const correctedTrack = typeof responseTrack.name === "string"
    ? responseTrack.name.trim()
    : "";

  const artistChanged = correctedArtist && correctedArtist !== artist.trim();
  const trackChanged = correctedTrack && correctedTrack !== track.trim();
  if (!artistChanged && !trackChanged) return;

  const field: "artist" | "track" | "both" =
    artistChanged && trackChanged ? "both" : artistChanged ? "artist" : "track";
  lastfmAutocorrectionsTotal.inc({ field });
  console.log(
    `[Last.fm] Autocorrected "${artist} - ${track}" -> ` +
      `"${correctedArtist || artist} - ${correctedTrack || track}" (${field})`,
  );
};

export const getLastFmPopularity = async (artist: string, track: string): Promise<number | null> => {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) return null;

  const endTimer = providerRequestDurationSeconds.startTimer({ provider: PROVIDER });
  let result: Outcome = "success";

  try {
    const response = await axios.get("http://ws.audioscrobbler.com/2.0/", {
      params: buildTrackParams(apiKey, artist, track),
      timeout: REQUEST_TIMEOUT_MS,
    });

    logAutocorrect(artist, track, response.data?.track);

    if (response.data && response.data.track && response.data.track.playcount) {
      const playcount = parseInt(response.data.track.playcount, 10);

      // Normalize playcount to 0-100 using a log scale.
      // E.g., 1 play = 0, 10 plays = 11, 1M plays = 66, 1B plays = 100
      const logPlays = Math.log10(Math.max(1, playcount));
      const normalizedScore = Math.min(100, Math.max(0, (logPlays / 9) * 100));

      return Number(normalizedScore.toFixed(2));
    }

    result = "not_found";
    return null;
  } catch (error: any) {
    result = classifyError(error);
    const reason = error?.code === "ECONNABORTED" ? "timeout" : (error?.code || error?.message || "error");
    console.error(`[Last.fm] Popularity fetch failed for ${artist} - ${track} (${reason})`);
    return null;
  } finally {
    endTimer();
    providerRequestsTotal.inc({ provider: PROVIDER, result });
  }
};

export const getLastFmTrackTags = async (artist: string, track: string): Promise<string[]> => {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) return [];

  const endTimer = providerRequestDurationSeconds.startTimer({ provider: PROVIDER });
  let result: Outcome = "success";

  try {
    const response = await axios.get("http://ws.audioscrobbler.com/2.0/", {
      params: buildTrackParams(apiKey, artist, track),
      timeout: REQUEST_TIMEOUT_MS,
    });

    logAutocorrect(artist, track, response.data?.track);

    if (response.data?.track?.toptags?.tag) {
      const tags = response.data.track.toptags.tag;
      // Last.fm can return an array or a single object. Ensure it's an array.
      const tagArray = Array.isArray(tags) ? tags : [tags];
      // Filter out low quality tags and return top 5
      const filtered = tagArray
        .map((t: any) => t.name.toLowerCase().trim())
        .filter((t: string) => t.length > 2)
        .slice(0, 5);
      if (filtered.length === 0) result = "not_found";
      return filtered;
    }

    result = "not_found";
    return [];
  } catch (error: any) {
    result = classifyError(error);
    const reason = error?.code === "ECONNABORTED" ? "timeout" : (error?.code || error?.message || "error");
    console.error(`[Last.fm] Tags fetch failed for ${artist} - ${track} (${reason})`);
    return [];
  } finally {
    endTimer();
    providerRequestsTotal.inc({ provider: PROVIDER, result });
  }
};
