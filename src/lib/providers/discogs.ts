import axios from "axios";
import {
  providerRequestDurationSeconds,
  providerRequestsTotal,
} from "../metrics";

const PROVIDER = "discogs";

type Outcome = "success" | "not_found" | "timeout" | "rate_limited" | "error";

function classifyError(error: any): "timeout" | "rate_limited" | "error" {
  if (error?.code === "ECONNABORTED") return "timeout";
  if (error?.response?.status === 429) return "rate_limited";
  return "error";
}

function envEnabled(name: string, defaultValue: boolean) {
  const value = process.env[name]?.toLowerCase();
  if (!value) return defaultValue;
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function getDiscogsConsumerCredentials() {
  return {
    key: (process.env.DISCOGS_CONSUMER_KEY || "").trim(),
    secret: (process.env.DISCOGS_CONSUMER_SECRET || "").trim(),
  };
}

function getDiscogsOAuthAccessCredentials() {
  return {
    token: (process.env.DISCOGS_ACCESS_TOKEN || "").trim(),
    tokenSecret: (process.env.DISCOGS_ACCESS_TOKEN_SECRET || "").trim(),
  };
}

export const isDiscogsTagLookupEnabled = () => {
  const consumer = getDiscogsConsumerCredentials();
  return envEnabled("DISCOGS_TAGS_ENABLED", false) &&
    Boolean(consumer.key) &&
    Boolean(consumer.secret);
};

function getDiscogsUserAgent() {
  return (process.env.DISCOGS_USER_AGENT || "Mixarr/1.0").trim();
}

function oauthEncode(value: string) {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function getOAuthNonce() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replace(/-/g, "");
  }

  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now()}${Math.random().toString(16).slice(2)}`;
}

function buildDiscogsAuthorizationHeader() {
  const consumer = getDiscogsConsumerCredentials();
  const access = getDiscogsOAuthAccessCredentials();

  if (!consumer.key || !consumer.secret) return "";

  if (access.token && access.tokenSecret) {
    const oauthParams: Record<string, string> = {
      oauth_consumer_key: consumer.key,
      oauth_nonce: getOAuthNonce(),
      oauth_signature: `${consumer.secret}&${access.tokenSecret}`,
      oauth_signature_method: "PLAINTEXT",
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_token: access.token,
    };

    return `OAuth ${Object.entries(oauthParams)
      .map(([key, value]) => `${oauthEncode(key)}="${oauthEncode(value)}"`)
      .join(", ")}`;
  }

  return `Discogs key=${consumer.key}, secret=${consumer.secret}`;
}

function collectResultTags(results: any[]) {
  const tags: string[] = [];

  for (const result of results) {
    if (Array.isArray(result?.style)) tags.push(...result.style);
    if (Array.isArray(result?.genre)) tags.push(...result.genre);
  }

  return tags;
}

export const getDiscogsTrackTags = async (artist: string, track: string): Promise<string[]> => {
  if (!isDiscogsTagLookupEnabled()) return [];

  const endTimer = providerRequestDurationSeconds.startTimer({ provider: PROVIDER });
  let result: Outcome = "success";

  try {
    const searches = [
      { q: track, artist, type: "release" },
      { q: `${artist} ${track}`, type: "release" },
      { q: `${artist} ${track}`, type: "master" },
    ];

    for (const params of searches) {
      const response = await axios.get("https://api.discogs.com/database/search", {
        params: {
          ...params,
          per_page: 5,
        },
        headers: {
          Authorization: buildDiscogsAuthorizationHeader(),
          "User-Agent": getDiscogsUserAgent(),
        },
        timeout: 10000,
      });

      const tags = collectResultTags(response.data?.results || []);
      if (tags.length > 0) return tags;
    }

    result = "not_found";
    return [];
  } catch (error: any) {
    result = classifyError(error);
    const reason = error?.code === "ECONNABORTED" ? "timeout" : (error?.code || error?.message || "error");
    console.error(`[Discogs] Tags fetch failed for ${artist} - ${track} (${reason})`);
    if (result === "rate_limited") {
      throw new Error("RATE_LIMIT:discogs");
    }
    return [];
  } finally {
    endTimer();
    providerRequestsTotal.inc({ provider: PROVIDER, result });
  }
};
