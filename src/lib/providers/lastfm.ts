import axios from "axios";

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

  console.log(
    `[Last.fm] Autocorrected "${artist} - ${track}" -> ` +
      `"${correctedArtist || artist} - ${correctedTrack || track}"`,
  );
};

export const getLastFmPopularity = async (artist: string, track: string): Promise<number | null> => {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await axios.get("http://ws.audioscrobbler.com/2.0/", {
      params: buildTrackParams(apiKey, artist, track),
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

    return null;
  } catch (error) {
    console.error(`Last.fm fetch failed for ${artist} - ${track}`);
    return null;
  }
};

export const getLastFmTrackTags = async (artist: string, track: string): Promise<string[]> => {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) return [];

  try {
    const response = await axios.get("http://ws.audioscrobbler.com/2.0/", {
      params: buildTrackParams(apiKey, artist, track),
    });

    logAutocorrect(artist, track, response.data?.track);

    if (response.data?.track?.toptags?.tag) {
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
  } catch (error) {
    console.error(`Last.fm tags fetch failed for ${artist} - ${track}`);
    return [];
  }
};
