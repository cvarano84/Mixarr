import axios from "axios";

const PLEX_TV_URL = "https://plex.tv/api/v2";

export interface PlexPin {
  id: number;
  code: string;
  clientIdentifier: string;
  authToken: string | null;
}

export interface PlexUser {
  id: number;
  username: string;
  email: string;
  thumb: string;
}

export interface PlexResource {
  name: string;
  clientIdentifier: string;
  accessToken: string;
  connections: {
    protocol: string;
    address: string;
    port: number;
    uri: string;
    local: boolean;
  }[];
}

const getPlexHeaders = () => {
  return {
    "X-Plex-Client-Identifier": (process.env.PLEX_CLIENT_IDENTIFIER || "mixarr-default-client").trim(),
    "X-Plex-Product": (process.env.PLEX_PRODUCT_NAME || "Mixarr").trim(),
    "X-Plex-Version": "1.0",
    "X-Plex-Device": "Web",
    "X-Plex-Platform": "Web",
    "Accept": "application/json",
  };
};

export const requestPin = async (): Promise<PlexPin> => {
  const response = await axios.post(`${PLEX_TV_URL}/pins?strong=true`, null, {
    headers: getPlexHeaders(),
  });
  return response.data;
};

export const checkPin = async (pinId: number): Promise<PlexPin> => {
  const response = await axios.get(`${PLEX_TV_URL}/pins/${pinId}`, {
    headers: getPlexHeaders(),
  });
  return response.data;
};

export const getUser = async (authToken: string): Promise<PlexUser> => {
  const response = await axios.get(`${PLEX_TV_URL}/user`, {
    headers: {
      ...getPlexHeaders(),
      "X-Plex-Token": authToken,
    },
  });
  return response.data;
};

export const getServers = async (authToken: string): Promise<PlexResource[]> => {
  const response = await axios.get(`${PLEX_TV_URL}/resources?includeHttps=1`, {
    headers: {
      ...getPlexHeaders(),
      "X-Plex-Token": authToken,
    },
  });
  
  // Filter for servers that own media
  const servers = response.data.filter((r: any) => r.provides.includes("server"));
  return servers;
};

export const getLibraries = async (serverUri: string, accessToken: string) => {
  const response = await axios.get(`${serverUri}/library/sections`, {
    headers: {
      ...getPlexHeaders(),
      "X-Plex-Token": accessToken,
    },
  });
  return response.data.MediaContainer.Directory;
};

export interface ReachableConnection {
  /** The first connection URI that responded successfully, or null when nothing answered. */
  uri: string | null;
  /** How many connections we attempted (== connections.length unless the list was empty). */
  tried: number;
  /** Wall-clock time spent racing the connections, for log/metric output. */
  elapsedMs: number;
}

/**
 * Race every candidate connection for a Plex server in parallel and
 * return the first one that successfully answers GET /identity. All
 * still-pending attempts are aborted as soon as we have a winner.
 *
 * Plex's /resources endpoint returns every server the user has access
 * to, including friends' servers on networks the Mixarr container can't
 * reach. The original sequential implementation paid a 2-second timeout
 * for every unreachable connection on every unreachable server, which is
 * what made the login flow feel "stuck" and produced dozens of timeout
 * stack traces in the container logs after a single sign-in.
 */
export const findReachableConnection = async (
  connections: PlexResource["connections"],
  timeoutMs = 1500,
): Promise<ReachableConnection> => {
  if (!connections.length) {
    return { uri: null, tried: 0, elapsedMs: 0 };
  }

  // Local IPs first so that on a home LAN the local-network attempt is
  // the one we end up keeping even when a relay also happens to work.
  // Promise.any returns the first to RESOLVE, so this is a soft hint
  // rather than a hard ordering, but locals almost always win the race.
  const sorted = [...connections].sort((a, b) =>
    a.local === b.local ? 0 : a.local ? -1 : 1,
  );

  // Once one connection succeeds we trip this controller to short-circuit
  // every other in-flight fetch instead of letting them run to timeout.
  const giveUp = new AbortController();
  const start = Date.now();

  const attempts = sorted.map(async (conn) => {
    const perAttempt = new AbortController();
    const timer = setTimeout(() => perAttempt.abort(), timeoutMs);
    const cancelOnWinner = () => perAttempt.abort();
    giveUp.signal.addEventListener("abort", cancelOnWinner);

    try {
      const res = await fetch(`${conn.uri}/identity`, {
        headers: { Accept: "application/json" },
        signal: perAttempt.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return conn.uri;
    } finally {
      clearTimeout(timer);
      giveUp.signal.removeEventListener("abort", cancelOnWinner);
    }
  });

  try {
    const uri = await Promise.any(attempts);
    giveUp.abort();
    return { uri, tried: connections.length, elapsedMs: Date.now() - start };
  } catch {
    // Promise.any only rejects (with AggregateError) when every attempt
    // failed, which is the expected "no reachable connection" outcome.
    return { uri: null, tried: connections.length, elapsedMs: Date.now() - start };
  }
};
