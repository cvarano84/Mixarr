import axios from "axios";

// See note in audiodb.ts.
const REQUEST_TIMEOUT_MS = 15_000;

export const getLastFmPopularity = async (artist: string, track: string): Promise<number | null> => {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await axios.get("http://ws.audioscrobbler.com/2.0/", {
      params: {
        method: "track.getInfo",
        api_key: apiKey,
        artist: artist,
        track: track,
        format: "json",
      },
      timeout: REQUEST_TIMEOUT_MS,
    });

    if (response.data && response.data.track && response.data.track.playcount) {
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
    const response = await axios.get("http://ws.audioscrobbler.com/2.0/", {
      params: {
        method: "track.getInfo",
        api_key: apiKey,
        artist: artist,
        track: track,
        format: "json",
      },
      timeout: REQUEST_TIMEOUT_MS,
    });

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
  } catch (error: any) {
    const reason = error?.code === "ECONNABORTED" ? "timeout" : (error?.code || error?.message || "error");
    console.error(`[Last.fm] Tags fetch failed for ${artist} - ${track} (${reason})`);
    return [];
  }
};
