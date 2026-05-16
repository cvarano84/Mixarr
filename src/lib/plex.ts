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
  uri: string | null;
  tried: number;
  elapsedMs: number;
}

export const findReachableConnection = async (
  connections: PlexResource["connections"],
  timeoutMs = 1500,
): Promise<ReachableConnection> => {
  if (!connections.length) {
    return { uri: null, tried: 0, elapsedMs: 0 };
  }

  const sorted = [...connections].sort((a, b) =>
    a.local === b.local ? 0 : a.local ? -1 : 1,
  );
  const abortRemaining = new AbortController();
  const start = Date.now();

  const attempts = sorted.map(async (conn) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const cancel = () => controller.abort();
    abortRemaining.signal.addEventListener("abort", cancel);

    try {
      const response = await fetch(`${conn.uri}/identity`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return conn.uri;
    } finally {
      clearTimeout(timer);
      abortRemaining.signal.removeEventListener("abort", cancel);
    }
  });

  try {
    const uri = await Promise.any(attempts);
    abortRemaining.abort();
    return { uri, tried: connections.length, elapsedMs: Date.now() - start };
  } catch {
    return { uri: null, tried: connections.length, elapsedMs: Date.now() - start };
  }
};
