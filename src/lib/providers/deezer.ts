import axios from "axios";
import {
  providerRequestDurationSeconds,
  providerRequestsTotal,
} from "../metrics";
import { RateLimitError, parseRetryAfterMs } from "./rateLimit";

// See note in audiodb.ts. Without an explicit timeout, a single dropped TCP
// connection can stall a worker for ~15 minutes (kernel tcp_retries2 default).
const REQUEST_TIMEOUT_MS = 15_000;

const PROVIDER = "deezer";

type Outcome = "success" | "not_found" | "timeout" | "rate_limited" | "error";

const genreNameCache = new Map<string, string>();

function classifyError(error: any): "timeout" | "rate_limited" | "error" {
  if (error?.code === "ECONNABORTED") return "timeout";
  if (error?.response?.status === 429) return "rate_limited";
  return "error";
}

// Build the RateLimitError to re-throw on 429. Reads the Retry-After header
// if Deezer sends one so the engine knows roughly how long to wait.
function buildRateLimitError(error: any): RateLimitError {
  const retryAfterMs = parseRetryAfterMs(error?.response?.headers?.["retry-after"]);
  return new RateLimitError(PROVIDER, retryAfterMs);
}


export const getDeezerPopularity = async (artist: string, track: string): Promise<number | null> => {
  const endTimer = providerRequestDurationSeconds.startTimer({ provider: PROVIDER });
  let result: Outcome = "success";

  try {
    const query = `artist:"${artist}" track:"${track}"`;
    const response = await axios.get("https://api.deezer.com/search", {
      params: { q: query, limit: 1 },
      timeout: REQUEST_TIMEOUT_MS,
    });

    if (response.data && response.data.data && response.data.data.length > 0) {
      const rank = response.data.data[0].rank; // 0 to 1,000,000

      // Normalize Deezer Rank (0 - 1M) to 0-100 scale
      // Note: Rank scales logarithmically, so 500k is huge, 100k is popular
      const normalizedScore = Math.min(100, Math.max(0, (rank / 1000000) * 100));
      return Number(normalizedScore.toFixed(2));
    }

    result = "not_found";
    return null;
  } catch (error: any) {
    result = classifyError(error);
    const reason = error?.code === "ECONNABORTED" ? "timeout" : (error?.code || error?.message || "error");
    console.error(`[Deezer] Popularity fetch failed for ${artist} - ${track} (${reason})`);
    // Surface rate-limits so the engine can re-queue the track instead of
    // saving a not_found marker that locks it out for the next 14 days.
    if (result === "rate_limited") {
      throw buildRateLimitError(error);
    }
    return null;
  } finally {
    endTimer();
    providerRequestsTotal.inc({ provider: PROVIDER, result });
  }
};

export const getDeezerBpm = async (artist: string, track: string): Promise<number | null> => {
  const endTimer = providerRequestDurationSeconds.startTimer({ provider: PROVIDER });
  let result: Outcome = "success";

  try {
    const query = `artist:"${artist}" track:"${track}"`;
    // Step 1: Search to get the Deezer Track ID
    const searchRes = await axios.get("https://api.deezer.com/search", {
      params: { q: query, limit: 1 },
      timeout: REQUEST_TIMEOUT_MS,
    });

    if (searchRes.data && searchRes.data.data && searchRes.data.data.length > 0) {
      const trackId = searchRes.data.data[0].id;
      
      // Step 2: Fetch the track details which contains the BPM
      const trackRes = await axios.get(`https://api.deezer.com/track/${trackId}`, { timeout: REQUEST_TIMEOUT_MS });
      if (trackRes.data && trackRes.data.bpm) {
        return trackRes.data.bpm;
      }
    }

    result = "not_found";
    return null;
  } catch (error: any) {
    result = classifyError(error);
    const reason = error?.code === "ECONNABORTED" ? "timeout" : (error?.code || error?.message || "error");
    console.error(`[Deezer] BPM fetch failed for ${artist} - ${track} (${reason})`);
    // Surface rate-limits so the BPM/audio-feature engines can re-queue
    // the track instead of falling back to local analysis (or writing a
    // not_found marker) and locking the track out of Deezer for 14 days.
    if (result === "rate_limited") {
      throw buildRateLimitError(error);
    }
    return null;
  } finally {
    endTimer();
    providerRequestsTotal.inc({ provider: PROVIDER, result });
  }
};

async function getDeezerGenreName(genreId: string) {
  if (genreNameCache.has(genreId)) return genreNameCache.get(genreId);

  const response = await axios.get(`https://api.deezer.com/genre/${genreId}`, {
    timeout: REQUEST_TIMEOUT_MS,
  });
  const name = typeof response.data?.name === "string" ? response.data.name : undefined;
  if (name) genreNameCache.set(genreId, name);
  return name;
}

async function collectAlbumGenreNames(album: any) {
  const names: string[] = [];

  const genreData = album?.genres?.data;
  if (Array.isArray(genreData)) {
    for (const genre of genreData) {
      if (typeof genre?.name === "string") names.push(genre.name);
    }
  }

  if (names.length === 0 && (typeof album?.genre_id === "number" || typeof album?.genre_id === "string")) {
    const genreName = await getDeezerGenreName(String(album.genre_id));
    if (genreName) names.push(genreName);
  }

  return names;
}

export const getDeezerTrackTags = async (artist: string, track: string): Promise<string[]> => {
  const endTimer = providerRequestDurationSeconds.startTimer({ provider: PROVIDER });
  let result: Outcome = "success";

  try {
    const query = `artist:"${artist}" track:"${track}"`;
    const searchRes = await axios.get("https://api.deezer.com/search", {
      params: { q: query, limit: 5 },
      timeout: REQUEST_TIMEOUT_MS,
    });

    const matches = Array.isArray(searchRes.data?.data) ? searchRes.data.data : [];
    const albumIds = Array.from(new Set(
      matches
        .map((match: any) => match?.album?.id)
        .filter((id: unknown): id is number | string =>
          typeof id === "number" || typeof id === "string",
        ),
    ));

    const tags: string[] = [];
    for (const albumId of albumIds.slice(0, 3)) {
      const albumRes = await axios.get(`https://api.deezer.com/album/${albumId}`, {
        timeout: REQUEST_TIMEOUT_MS,
      });
      tags.push(...await collectAlbumGenreNames(albumRes.data));
    }

    if (tags.length === 0) result = "not_found";
    return tags;
  } catch (error: any) {
    result = classifyError(error);
    const reason = error?.code === "ECONNABORTED" ? "timeout" : (error?.code || error?.message || "error");
    console.error(`[Deezer] Tags fetch failed for ${artist} - ${track} (${reason})`);
    if (result === "rate_limited") {
      throw buildRateLimitError(error);
    }
    return [];
  } finally {
    endTimer();
    providerRequestsTotal.inc({ provider: PROVIDER, result });
  }
};
