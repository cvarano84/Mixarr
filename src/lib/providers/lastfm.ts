import axios from "axios";

// See note in audiodb.ts.
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Whether LASTFM_AUTOCORRECT is enabled. Re-read on every call so a
 * `docker compose up -d` with a new value takes effect on the next
 * Last.fm request instead of requiring a process restart. Cost is
 * negligible (string comparison) compared to a 15s-timeout HTTP call.
 *
 * Accepts "1", "true", "yes", "on" (case-insensitive). Anything else,
 * or unset, evaluates to false.
 */
const isAutocorrectEnabled = (): boolean => {
  const v = process.env.LASTFM_AUTOCORRECT?.toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
};

/**
 * Inspect a Last.fm track.getInfo response and, if autocorrect actually
 * rewrote the artist and/or track name, log the change so the rewrites
 * are visible in Graylog.
 *
 * Last.fm signals autocorrect in two ways:
 *   1. The returned `track.name` / `track.artist.name` differ from what
 *      we sent.
 *   2. Optional boolean-ish `corrected` fields on the JSON response
 *      (`response.data.track.corrected`, `response.data.track.artist.corrected`).
 *      These aren't always present in the JSON output, so we treat them
 *      as a hint and fall back to direct string comparison.
 *
 * We deliberately do a case-sensitive comparison so that casing fixes
 * ("the beatles" -> "The Beatles") count as corrections - that's
 * exactly the kind of fix the user is enabling autocorrect to get.
 */
const observeAutocorrect = (
  sentArtist: string,
  sentTrack: string,
  responseTrack: any,
): void => {
  if (!responseTrack) return;

  const recvArtist = typeof responseTrack?.artist?.name === "string"
    ? responseTrack.artist.name.trim()
    : "";
  const recvTrack = typeof responseTrack?.name === "string"
    ? responseTrack.name.trim()
    : "";

  const artistCorrected = !!recvArtist && recvArtist !== sentArtist.trim();
  const trackCorrected = !!recvTrack && recvTrack !== sentTrack.trim();
  if (!artistCorrected && !trackCorrected) return;

  const field: "artist" | "track" | "both" =
    artistCorrected && trackCorrected ? "both" : artistCorrected ? "artist" : "track";
  console.log(
    `[Last.fm] Autocorrected "${sentArtist} - ${sentTrack}" -> "${recvArtist || sentArtist} - ${recvTrack || sentTrack}" (${field})`,
  );
};

export const getLastFmPopularity = async (artist: string, track: string): Promise<number | null> => {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) return null;

  try {
    const params: Record<string, string> = {
      method: "track.getInfo",
      api_key: apiKey,
      artist: artist,
      track: track,
      format: "json",
    };
    if (isAutocorrectEnabled()) params.autocorrect = "1";

    const response = await axios.get("http://ws.audioscrobbler.com/2.0/", {
      params,
      timeout: REQUEST_TIMEOUT_MS,
    });

    if (response.data && response.data.track && response.data.track.playcount) {
      observeAutocorrect(artist, track, response.data.track);

      const playcount = parseInt(response.data.track.playcount, 10);
      
      // Normalize playcount to 0-100 using a log scale.
      // E.g., 1 play = 0, 10 plays = 11, 1M plays = 66, 1B plays = 100
      const logPlays = Math.log10(Math.max(1, playcount));
      const normalizedScore = Math.min(100, Math.max(0, (logPlays / 9) * 100));
      
      return Number(normalizedScore.toFixed(2));
    }

    return null;
  } catch (error: any) {
    const reason = error?.code === "ECONNABORTED" ? "timeout" : (error?.code || error?.message || "error");
    console.error(`[Last.fm] Popularity fetch failed for ${artist} - ${track} (${reason})`);
    return null;
  }
};

export const getLastFmTrackTags = async (artist: string, track: string): Promise<string[]> => {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) return [];

  try {
    const params: Record<string, string> = {
      method: "track.getInfo",
      api_key: apiKey,
      artist: artist,
      track: track,
      format: "json",
    };
    if (isAutocorrectEnabled()) params.autocorrect = "1";

    const response = await axios.get("http://ws.audioscrobbler.com/2.0/", {
      params,
      timeout: REQUEST_TIMEOUT_MS,
    });

    if (response.data?.track?.toptags?.tag) {
      observeAutocorrect(artist, track, response.data.track);

      const tags = response.data.track.toptags.tag;
      // Last.fm can return an array or a single object. Ensure it's an array.
      const tagArray = Array.isArray(tags) ? tags : [tags];
      // Filter out low quality tags and return top 5
      return tagArray
        .map((t: any) => t.name.toLowerCase().trim())
        .filter((t: string) => t.length > 2)
        .slice(0, 5);
    }

    return [];
  } catch (error: any) {
    const reason = error?.code === "ECONNABORTED" ? "timeout" : (error?.code || error?.message || "error");
    console.error(`[Last.fm] Tags fetch failed for ${artist} - ${track} (${reason})`);
    return [];
  }
};
