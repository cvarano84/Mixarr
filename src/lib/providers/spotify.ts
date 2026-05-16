import axios from "axios";
import prisma from "../prisma";

const SPOTIFY_FAILURE_KEY = "spotify_token_failure_time";

let spotifyToken: string | null = null;
let tokenExpirationTime: number = 0;
let tokenFailureTime: number = 0;
let loadStatePromise: Promise<void> | null = null;

const ensureStateLoaded = async (): Promise<void> => {
  if (!loadStatePromise) {
    loadStatePromise = loadPersistedState();
  }
  await loadStatePromise;
};

const loadPersistedState = async (): Promise<void> => {
  try {
    const row = await prisma.systemState.findUnique({
      where: { key: SPOTIFY_FAILURE_KEY },
    });
    if (!row) return;

    const persistedTime = Number(row.value);
    if (Number.isFinite(persistedTime) && persistedTime > Date.now()) {
      tokenFailureTime = persistedTime;
      const remainingSeconds = Math.round((persistedTime - Date.now()) / 1000);
      console.log(`[Spotify] Loaded persisted rate-limit backoff: ${remainingSeconds}s remaining`);
    }
  } catch (error) {
    console.error("[Spotify] Failed to load persisted rate-limit state:", error);
  }
};

const persistFailureTime = (failureTime: number): void => {
  prisma.systemState
    .upsert({
      where: { key: SPOTIFY_FAILURE_KEY },
      update: { value: String(failureTime) },
      create: { key: SPOTIFY_FAILURE_KEY, value: String(failureTime) },
    })
    .catch((error) => console.error("[Spotify] Failed to persist rate-limit state:", error));
};

const setTokenFailureTime = (failureTime: number): void => {
  tokenFailureTime = failureTime;
  persistFailureTime(failureTime);
};

const getSpotifyToken = async (): Promise<string | null> => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  await ensureStateLoaded();

  if (Date.now() < tokenFailureTime) {
    return null;
  }

  // Return cached token if valid
  if (spotifyToken && Date.now() < tokenExpirationTime) {
    return spotifyToken;
  }

  try {
    const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      'grant_type=client_credentials',
      {
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    spotifyToken = response.data.access_token;
    // Expire 5 minutes early to be safe
    tokenExpirationTime = Date.now() + (response.data.expires_in - 300) * 1000;
    
    return spotifyToken;
  } catch (error: any) {
    const status = error.response?.status;
    console.error("Failed to authenticate with Spotify API:", status || error.message);
    
    if (status === 429) {
      const retryAfter = Number(error.response?.headers['retry-after']) || 60;
      setTokenFailureTime(Date.now() + (retryAfter * 1000));
      throw new Error(`RATE_LIMIT:${retryAfter}`);
    } else {
      // Backoff for 60 seconds on any other auth error (e.g., 401 invalid client)
      setTokenFailureTime(Date.now() + 60000);
      return null;
    }
  }
};

export const getSpotifyPopularity = async (artist: string, track: string): Promise<number | null> => {
  try {
    const token = await getSpotifyToken();
    if (!token) return null;

    const query = `artist:${artist} track:${track}`;
    const response = await axios.get("https://api.spotify.com/v1/search", {
      params: {
        q: query,
        type: "track",
        limit: 1
      },
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.data && response.data.tracks && response.data.tracks.items.length > 0) {
      // Spotify already returns a 0-100 normalized score
      return response.data.tracks.items[0].popularity;
    }

    return null;
  } catch (error: any) {
    if (error.message === "NO_TOKEN" || (error.message && error.message.startsWith("RATE_LIMIT"))) {
      throw error;
    }

    const status = error.response?.status;
    if (status === 429) {
      const retryAfter = Number(error.response?.headers['retry-after']) || 5;
      setTokenFailureTime(Date.now() + (retryAfter * 1000));
      console.warn(`[Spotify] Popularity rate limited. Backing off for ${retryAfter}s...`);
      throw new Error(`RATE_LIMIT:${retryAfter}`); 
    }

    console.error(`Spotify fetch failed for ${artist} - ${track}:`, error.message, status || '');
    return null;
  }
};

export const getSpotifyAudioFeatures = async (artist: string, track: string): Promise<any> => {
  try {
    const token = await getSpotifyToken();
    if (!token) throw new Error("NO_TOKEN");

    // Simplify query to avoid strict matching failures with special characters
    const query = `${artist} ${track}`.substring(0, 100); // Spotify max query length
    
    const searchRes = await axios.get("https://api.spotify.com/v1/search", {
      params: { q: query, type: "track", limit: 1 },
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!searchRes.data?.tracks?.items?.length) {
      return null;
    }

    const spotifyTrackId = searchRes.data.tracks.items[0].id;

    const featureRes = await axios.get(`https://api.spotify.com/v1/audio-features/${spotifyTrackId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!featureRes.data) return null;

    return {
      energy: featureRes.data.energy,
      valence: featureRes.data.valence,
      danceability: featureRes.data.danceability,
      tempo: featureRes.data.tempo
    };
  } catch (error: any) {
    if (error.message === "NO_TOKEN" || (error.message && error.message.startsWith("RATE_LIMIT"))) {
      throw error; // Let the engine catch auth/rate limit errors so it doesn't save empty rows
    }

    const status = error.response?.status;
    if (status === 429) {
      const retryAfter = Number(error.response?.headers['retry-after']) || 5;
      setTokenFailureTime(Date.now() + (retryAfter * 1000));
      console.warn(`[Spotify] Audio features rate limited. Backing off for ${retryAfter}s...`);
      throw new Error(`RATE_LIMIT:${retryAfter}`); 
    }
    
    if (status === 403) {
      // Spotify deprecated the Audio Features endpoint on Nov 27, 2024. It returns 403 Forbidden.
      console.warn(`[Spotify] Audio Features API is deprecated and returned 403 Forbidden for ${track}.`);
      return null;
    }
    
    console.error(`[Spotify] Error fetching ${artist} - ${track}:`, error.message, status || '');
    return null;
  }
};
