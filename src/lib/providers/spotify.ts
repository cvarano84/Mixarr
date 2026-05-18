import axios from "axios";
import prisma from "../prisma";
import {
  providerRequestDurationSeconds,
  providerRequestsTotal,
} from "../metrics";
import { RateLimitError, parseRetryAfterMs } from "./rateLimit";

// See note in audiodb.ts.
const REQUEST_TIMEOUT_MS = 15_000;

const PROVIDER = "spotify";

type Outcome = "success" | "not_found" | "timeout" | "rate_limited" | "error";

function classifyError(error: any): "timeout" | "rate_limited" | "error" {
  if (error?.code === "ECONNABORTED") return "timeout";
  if (error?.response?.status === 429) return "rate_limited";
  return "error";
}

const truthyEnv = (value: string | undefined) => {
  const normalized = value?.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

// True iff Spotify credentials are set in the environment. Use this to
// distinguish "Spotify isn't configured, skip it" (caller returns null and
// lets the engine fall through to other providers) from "creds are set
// but the token endpoint refused us" (which we treat as a rate-limit so
// the engine re-queues instead of writing a not_found marker).
const isSpotifyConfigured = () =>
  Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);

export const isSpotifyTagLookupEnabled = () => {
  return truthyEnv(process.env.SPOTIFY_TAGS_ENABLED) && isSpotifyConfigured();
};

// Key used in the SystemState table for the Spotify rate-limit backoff
// expiry. Persisting this is what makes a container restart respect a
// multi-hour 429 Retry-After instead of forgetting it and immediately
// hammering Spotify on the next run.
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
      const retryAfterMs = parseRetryAfterMs(error.response?.headers['retry-after']) ?? 60_000;
      setTokenFailureTime(Date.now() + retryAfterMs);
      throw new RateLimitError(PROVIDER, retryAfterMs);
    } else {
      // Backoff for 60 seconds on any other auth error (e.g., 401 invalid client)
      setTokenFailureTime(Date.now() + 60000);
      return null;
    }
  }
};

export const getSpotifyPopularity = async (artist: string, track: string): Promise<number | null> => {
  // Not configured: behave like a disabled provider so the popularity
  // engine falls through to whatever IS configured. We intentionally
  // don't even start the metrics timer in this case — a "Spotify isn't
  // set up" run shouldn't look like a real attempt in Grafana.
  if (!isSpotifyConfigured()) return null;

  const endTimer = providerRequestDurationSeconds.startTimer({ provider: PROVIDER });
  let result: Outcome = "success";

  try {
    const token = await getSpotifyToken();
    if (!token) {
      // Creds are present but we couldn't get a token, which only
      // happens when we're inside the persisted rate-limit backoff
      // window from a previous 429 (or a recent auth failure with its
      // own 60s cool-off). Surface as a rate-limit so the engine
      // re-queues the track instead of writing a not_found marker that
      // would lock it out of Spotify for the next 14 days.
      result = "rate_limited";
      throw new RateLimitError(PROVIDER);
    }

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

    result = "not_found";
    return null;
  } catch (error: any) {
    if (error instanceof RateLimitError) {
      result = "rate_limited";
      throw error;
    }
    if (error.message === "NO_TOKEN" || (error.message && error.message.startsWith("RATE_LIMIT"))) {
      result = "rate_limited";
      throw error;
    }

    result = classifyError(error);
    const status = error.response?.status;
    if (status === 429) {
      const retryAfterMs = parseRetryAfterMs(error.response?.headers['retry-after']) ?? 5000;
      setTokenFailureTime(Date.now() + retryAfterMs);
      console.warn(`[Spotify] Popularity rate limited. Backing off for ${Math.round(retryAfterMs / 1000)}s...`);
      throw new RateLimitError(PROVIDER, retryAfterMs);
    }

    console.error(`Spotify fetch failed for ${artist} - ${track}:`, error.message, status || '');
    return null;
  } finally {
    endTimer();
    providerRequestsTotal.inc({ provider: PROVIDER, result });
  }
};

export const getSpotifyTrackTags = async (artist: string, track: string): Promise<string[]> => {
  if (!isSpotifyTagLookupEnabled()) return [];

  const endTimer = providerRequestDurationSeconds.startTimer({ provider: PROVIDER });
  let result: Outcome = "success";

  try {
    const token = await getSpotifyToken();
    if (!token) {
      // Creds are set (isSpotifyTagLookupEnabled gated us in) but the
      // token endpoint is in backoff. Re-queue so the next batch can
      // try again — don't silently fall through to a worse provider.
      result = "rate_limited";
      throw new RateLimitError(PROVIDER);
    }

    const query = `artist:${artist} track:${track}`;
    const searchRes = await axios.get("https://api.spotify.com/v1/search", {
      params: {
        q: query,
        type: "track",
        limit: 1,
      },
      headers: {
        Authorization: `Bearer ${token}`,
      },
      timeout: REQUEST_TIMEOUT_MS,
    });

    const artistIds = searchRes.data?.tracks?.items?.[0]?.artists
      ?.map((entry: any) => entry?.id)
      ?.filter((id: unknown): id is string => typeof id === "string");

    if (!artistIds?.length) {
      result = "not_found";
      return [];
    }

    // Spotify exposes artist genres, not track genres. This stays opt-in
    // because the artist genre field is deprecated in the current Web API.
    const artistRes = await axios.get("https://api.spotify.com/v1/artists", {
      params: {
        ids: artistIds.slice(0, 5).join(","),
      },
      headers: {
        Authorization: `Bearer ${token}`,
      },
      timeout: REQUEST_TIMEOUT_MS,
    });

    const tags = (artistRes.data?.artists || []).flatMap((spotifyArtist: any) =>
      Array.isArray(spotifyArtist?.genres) ? spotifyArtist.genres : [],
    );

    if (tags.length === 0) result = "not_found";
    return tags;
  } catch (error: any) {
    if (error instanceof RateLimitError) {
      result = "rate_limited";
      throw error;
    }
    if (error.message === "NO_TOKEN" || (error.message && error.message.startsWith("RATE_LIMIT"))) {
      result = "rate_limited";
      throw error;
    }

    result = classifyError(error);
    const status = error.response?.status;
    if (status === 429) {
      const retryAfterMs = parseRetryAfterMs(error.response?.headers['retry-after']) ?? 5000;
      setTokenFailureTime(Date.now() + retryAfterMs);
      console.warn(`[Spotify] Tag lookup rate limited. Backing off for ${Math.round(retryAfterMs / 1000)}s...`);
      throw new RateLimitError(PROVIDER, retryAfterMs);
    }

    if (status === 403) {
      console.warn(`[Spotify] Tag lookup returned 403 Forbidden for ${track}.`);
      return [];
    }

    console.error(`[Spotify] Tag lookup failed for ${artist} - ${track}:`, error.message, status || '');
    return [];
  } finally {
    endTimer();
    providerRequestsTotal.inc({ provider: PROVIDER, result });
  }
};

export const getSpotifyAudioFeatures = async (artist: string, track: string): Promise<any> => {
  // Not configured: act as if this provider doesn't exist. The audio
  // feature engine ignores `null` and tries Deezer BPM independently.
  if (!isSpotifyConfigured()) return null;

  const endTimer = providerRequestDurationSeconds.startTimer({ provider: PROVIDER });
  let result: Outcome = "success";

  try {
    const token = await getSpotifyToken();
    if (!token) {
      // Creds are present but we're in backoff — re-queue.
      result = "rate_limited";
      throw new RateLimitError(PROVIDER);
    }

    // Simplify query to avoid strict matching failures with special characters
    const query = `${artist} ${track}`.substring(0, 100); // Spotify max query length
    
    const searchRes = await axios.get("https://api.spotify.com/v1/search", {
      params: { q: query, type: "track", limit: 1 },
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: REQUEST_TIMEOUT_MS,
    });

    if (!searchRes.data?.tracks?.items?.length) {
      result = "not_found";
      return null;
    }

    const spotifyTrackId = searchRes.data.tracks.items[0].id;

    const featureRes = await axios.get(`https://api.spotify.com/v1/audio-features/${spotifyTrackId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: REQUEST_TIMEOUT_MS,
    });

    if (!featureRes.data) {
      result = "not_found";
      return null;
    }

    return {
      energy: featureRes.data.energy,
      valence: featureRes.data.valence,
      danceability: featureRes.data.danceability,
      tempo: featureRes.data.tempo
    };
  } catch (error: any) {
    if (error instanceof RateLimitError) {
      result = "rate_limited";
      throw error;
    }
    if (error.message === "NO_TOKEN" || (error.message && error.message.startsWith("RATE_LIMIT"))) {
      result = "rate_limited";
      throw error; // Let the engine catch auth/rate limit errors so it doesn't save empty rows
    }

    result = classifyError(error);
    const status = error.response?.status;
    if (status === 429) {
      const retryAfterMs = parseRetryAfterMs(error.response?.headers['retry-after']) ?? 5000;
      setTokenFailureTime(Date.now() + retryAfterMs);
      console.warn(`[Spotify] Audio features rate limited. Backing off for ${Math.round(retryAfterMs / 1000)}s...`);
      throw new RateLimitError(PROVIDER, retryAfterMs);
    }
    
    if (status === 403) {
      // Spotify deprecated the Audio Features endpoint on Nov 27, 2024. It returns 403 Forbidden.
      console.warn(`[Spotify] Audio Features API is deprecated and returned 403 Forbidden for ${track}.`);
      return null;
    }
    
    console.error(`[Spotify] Error fetching ${artist} - ${track}:`, error.message, status || '');
    return null;
  } finally {
    endTimer();
    providerRequestsTotal.inc({ provider: PROVIDER, result });
  }
};
