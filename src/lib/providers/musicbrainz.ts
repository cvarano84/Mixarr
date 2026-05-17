import axios from "axios";
import {
  providerRequestDurationSeconds,
  providerRequestsTotal,
} from "../metrics";

const PROVIDER = "musicbrainz";
const API_ROOT = "https://musicbrainz.org/ws/2";

type Outcome = "success" | "not_found" | "timeout" | "rate_limited" | "error";
type ScoredTag = { name: string; count: number };

let lastRequestAt = 0;
let requestGate = Promise.resolve();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function classifyError(error: any): "timeout" | "rate_limited" | "error" {
  if (error?.code === "ECONNABORTED") return "timeout";
  const status = error?.response?.status;
  const retryAfter = error?.response?.headers?.["retry-after"];
  if (status === 429 || (status === 503 && retryAfter)) return "rate_limited";
  return "error";
}

function getUserAgent() {
  return (process.env.MUSICBRAINZ_USER_AGENT || "Mixarr/1.0 (local self-hosted playlist tool)").trim();
}

function getMinimumIntervalMs() {
  const configured = Number(process.env.MUSICBRAINZ_MIN_REQUEST_INTERVAL_MS || 1100);
  return Number.isFinite(configured) && configured >= 1000 ? configured : 1100;
}

async function waitForRateLimit() {
  const previous = requestGate;
  let release: () => void = () => {};
  requestGate = new Promise<void>(resolve => {
    release = () => resolve();
  });

  await previous;

  const waitMs = Math.max(0, lastRequestAt + getMinimumIntervalMs() - Date.now());
  if (waitMs > 0) await sleep(waitMs);
  lastRequestAt = Date.now();
  release();
}

async function musicBrainzGet<T>(path: string, params: Record<string, string | number>) {
  await waitForRateLimit();

  const response = await axios.get<T>(`${API_ROOT}${path}`, {
    params: {
      ...params,
      fmt: "json",
    },
    headers: {
      "User-Agent": getUserAgent(),
      Accept: "application/json",
    },
    timeout: 10000,
  });

  return response.data;
}

function quoteSearchTerm(value: string) {
  return value.trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function addTagsFromEntity(entity: any, tags: Map<string, ScoredTag>) {
  for (const field of ["genres", "tags"]) {
    const values = entity?.[field];
    if (!Array.isArray(values)) continue;

    for (const tag of values) {
      if (typeof tag?.name !== "string" || !tag.name.trim()) continue;
      const key = tag.name.toLowerCase().trim();
      const count = Number(tag.count || 0);
      const existing = tags.get(key);
      if (!existing || count > existing.count) {
        tags.set(key, { name: tag.name, count });
      }
    }
  }
}

function getArtistId(entity: any) {
  const credits = entity?.["artist-credit"];
  if (!Array.isArray(credits)) return null;

  const credit = credits.find((entry: any) => typeof entry?.artist?.id === "string");
  return credit?.artist?.id || null;
}

function getReleaseGroupIds(entity: any) {
  const releases = entity?.releases;
  if (!Array.isArray(releases)) return [];

  const ids = new Set<string>();
  for (const release of releases) {
    const id = release?.["release-group"]?.id;
    if (typeof id === "string") ids.add(id);
  }
  return Array.from(ids);
}

function finalizeTags(tags: Map<string, ScoredTag>) {
  return Array.from(tags.values())
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .map(tag => tag.name);
}

export const getMusicBrainzTrackTags = async (artist: string, track: string): Promise<string[]> => {
  const endTimer = providerRequestDurationSeconds.startTimer({ provider: PROVIDER });
  let result: Outcome = "success";

  try {
    const query = `artist:"${quoteSearchTerm(artist)}" AND recording:"${quoteSearchTerm(track)}"`;
    const search = await musicBrainzGet<any>("/recording", {
      query,
      limit: 3,
    });

    const recordings = Array.isArray(search?.recordings) ? search.recordings : [];
    if (recordings.length === 0) {
      result = "not_found";
      return [];
    }

    const tags = new Map<string, ScoredTag>();
    for (const recording of recordings) addTagsFromEntity(recording, tags);

    const bestRecording = recordings[0];
    if (typeof bestRecording?.id === "string") {
      const lookup = await musicBrainzGet<any>(`/recording/${bestRecording.id}`, {
        inc: "genres+tags+artist-credits+releases+release-groups",
      });

      addTagsFromEntity(lookup, tags);

      for (const releaseGroupId of getReleaseGroupIds(lookup).slice(0, 2)) {
        const releaseGroup = await musicBrainzGet<any>(`/release-group/${releaseGroupId}`, {
          inc: "genres+tags",
        });
        addTagsFromEntity(releaseGroup, tags);
      }

      if (tags.size === 0) {
        const artistId = getArtistId(lookup);
        if (artistId) {
          const artistLookup = await musicBrainzGet<any>(`/artist/${artistId}`, {
            inc: "genres+tags",
          });
          addTagsFromEntity(artistLookup, tags);
        }
      }
    }

    const resolvedTags = finalizeTags(tags);
    if (resolvedTags.length === 0) result = "not_found";
    return resolvedTags;
  } catch (error: any) {
    result = classifyError(error);
    const reason = error?.code === "ECONNABORTED" ? "timeout" : (error?.code || error?.message || "error");
    console.error(`[MusicBrainz] Tags fetch failed for ${artist} - ${track} (${reason})`);
    if (result === "rate_limited") {
      throw new Error("RATE_LIMIT:musicbrainz");
    }
    return [];
  } finally {
    endTimer();
    providerRequestsTotal.inc({ provider: PROVIDER, result });
  }
};
