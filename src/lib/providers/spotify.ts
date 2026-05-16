import axios from "axios";
import prisma from "../prisma";

// See note in audiodb.ts.
const REQUEST_TIMEOUT_MS = 15_000;

// Key used in the SystemState table for the Spotify rate-limit backoff
// expiry. Persisting this is what makes a container restart respect a
// multi-hour 429 Retry-After instead of forgetting it and immediately
// hammering Spotify on the next run.
const SPOTIFY_FAILURE_KEY = "spotify_token_failure_time";

let spotifyToken: string | null = null;
let tokenExpirationTime: number = 0;
let tokenFailureTime: number = 0;

// Loads the persisted backoff expiry from the database, but only once per
// process. Multiple concurrent callers all await the same in-flight promise
// so we don't issue duplicate queries.
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
    if (!Number.isFinite(persistedTime)) return;
    if (persistedTime > Date.now()) {
      tokenFailureTime = persistedTime;
      const remainingSec = Math.round((persistedTime - Date.now()) / 1000);
      console.log(`[Spotify] Loaded persisted rate-limit backoff: ${remainingSec}s remaining`);
    }
  } catch (e) {
    // Don't propagate - if the DB is briefly unavailable we'd rather behave
    // like the old in-memory-only code than crash the provider.
    console.error("[Spotify] Failed to load persisted rate-limit state:", e);
  }
};

const persistFailureTime = (failureTime: number): void => {
  // Fire-and-forget: we don't want to slow down the caller (which is
  // typically inside a catch block about to throw) waiting on a DB write,
  // and the in-memory value is the authoritative one for the rest of this
  // process's lifetime anyway. The DB copy is only for the *next* process.
  prisma.systemState
    .upsert({
      where: { key: SPOTIFY_FAILURE_KEY },
      update: { value: String(failureTime) },
      create: { key: SPOTIFY_FAILURE_KEY, value: String(failureTime) },
    })
    .catch(e => console.error("[Spotify] Failed to persist rate-limit state:", e));
};

const setTokenFailureTime = (failureTime: number): void => {
  tokenFailureTime = failureTime;
  persistFailureTime(failureTime);
};

const getSpotifyToken = async (): Promise<string | null> => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  // Hydrate the in-memory backoff from the database on first use of this
  // provider in this process.
  await ensureStateLoaded();

  // Enforce the 429 backoff BEFORE handing out any token, cached or fresh.
  //
  // The cached token is still technically valid for accounts.spotify.com,
  // but Spotify's product endpoints (/v1/search, /v1/audio-features, ...)
  // will keep returning 429 with the same multi-hour Retry-After, and each
  // 429 in getSpotifyPopularity / getSpotifyAudioFeatures rolls
  // `tokenFailureTime` forward to "now + Retry-After". When this check
  // sits *below* the cached-token short-circuit, the drain loop hammers
  // Spotify every ~250ms, the backoff deadline never stops moving forward,
  // and we never actually leave the rate-limited state. See README /
  // metrics dashboard for the symptom.
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
        },
        timeout: REQUEST_TIMEOUT_MS,
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
      },
      timeout: REQUEST_TIMEOUT_MS,
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
      // IMPORTANT: also block the cached token so we don't immediately
      // re-hit Spotify on every subsequent track. Without this, the engine
      // (especially under loop-to-empty) hammers Spotify forever.
      setTokenFailureTime(Date.now() + (retryAfter * 1000));
      console.warn(`[Spotify] Popularity Rate limited! Backing off for ${retryAfter}s...`);
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
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: REQUEST_TIMEOUT_MS,
    });

    if (!searchRes.data?.tracks?.items?.length) {
      return null;
    }

    const spotifyTrackId = searchRes.data.tracks.items[0].id;

    const featureRes = await axios.get(`https://api.spotify.com/v1/audio-features/${spotifyTrackId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: REQUEST_TIMEOUT_MS,
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
      // See comment in getSpotifyPopularity above.
      setTokenFailureTime(Date.now() + (retryAfter * 1000));
      console.warn(`[Spotify] Audio features rate limited! Backing off for ${retryAfter}s...`);
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
