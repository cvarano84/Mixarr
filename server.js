const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 4173;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, "plexmix-db.json");
const jobs = new Map();
const providerCache = new Map();
const db = loadDb();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function loadDb() {
  const defaults = {
    connection: {
      baseUrl: process.env.PLEX_URL || "",
      sectionKey: process.env.PLEX_MUSIC_SECTION_KEY || ""
    },
    provider: process.env.DEFAULT_POPULARITY_PROVIDER || "deezer",
    libraries: [],
    summary: null,
    tracks: [],
    playlists: []
  };

  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(defaults, null, 2));
      return defaults;
    }
    return { ...defaults, ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
  } catch (error) {
    console.warn(`Could not load database file: ${error.message}`);
    return defaults;
  }
}

function saveDb() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (error) {
    console.warn(`Could not save database file: ${error.message}`);
  }
}

function publicConfig() {
  const jobId = ensurePersistedJob();
  return {
    baseUrl: db.connection.baseUrl || process.env.PLEX_URL || "",
    sectionKey: db.connection.sectionKey || process.env.PLEX_MUSIC_SECTION_KEY || "",
    tokenConfigured: Boolean(process.env.PLEX_TOKEN),
    defaultProvider: db.provider || process.env.DEFAULT_POPULARITY_PROVIDER || "deezer",
    providerCredentials: {
      lastfmConfigured: Boolean(process.env.LASTFM_API_KEY),
      spotifyConfigured: Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET)
    },
    libraries: db.libraries || [],
    summary: db.summary,
    jobId,
    playlists: db.playlists || []
  };
}

function ensurePersistedJob() {
  if (!db.tracks?.length || !db.summary) return "";
  const id = "persisted-sync";
  if (!jobs.has(id)) {
    jobs.set(id, {
      id,
      config: resolvePlexConfig(),
      status: "complete",
      progress: 100,
      message: `Loaded ${db.tracks.length} tracks from saved data`,
      tracks: db.tracks,
      error: null,
      summary: db.summary,
      listeners: new Set()
    });
  }
  return id;
}

function resolvePlexConfig(body = {}) {
  return {
    baseUrl: body.baseUrl || db.connection.baseUrl || process.env.PLEX_URL || "",
    token: body.token || process.env.PLEX_TOKEN || "",
    sectionKey: body.sectionKey || db.connection.sectionKey || process.env.PLEX_MUSIC_SECTION_KEY || ""
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function cleanBaseUrl(baseUrl) {
  const parsed = new URL(baseUrl);
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

async function plexRequest(config, route, params = {}, options = {}) {
  const baseUrl = cleanBaseUrl(config.baseUrl);
  const url = new URL(`${baseUrl}${route}`);
  url.searchParams.set("X-Plex-Token", config.token);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      accept: "application/xml",
      "X-Plex-Product": "Plex Playlist Studio",
      "X-Plex-Version": "1.0.0",
      "X-Plex-Client-Identifier": "plex-playlist-studio-local"
    }
  });

  const text = await response.text();
  if (!response.ok) {
    const detail = text.replace(/\s+/g, " ").trim().slice(0, 220);
    throw new Error(`Plex returned ${response.status} for ${options.method || "GET"} ${route}: ${detail}`);
  }
  return text;
}

function decodeEntity(value) {
  return String(value || "")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseAttrs(source = "") {
  const attrs = {};
  const pattern = /([A-Za-z_:\-][\w:.\-]*)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = pattern.exec(source))) {
    attrs[match[1]] = decodeEntity(match[2]);
  }
  return attrs;
}

function parseSections(xml) {
  const sections = [];
  const pattern = /<Directory\b([^>]*)\/?>/g;
  let match;
  while ((match = pattern.exec(xml))) {
    const attrs = parseAttrs(match[1]);
    if (attrs.type === "artist") {
      sections.push({
        key: attrs.key,
        title: attrs.title,
        type: attrs.type
      });
    }
  }
  return sections;
}

function parseYear(attrs = {}) {
  const candidates = [
    attrs.year,
    attrs.parentYear,
    attrs.grandparentYear,
    attrs.originallyAvailableAt?.slice(0, 4),
    attrs.parentOriginallyAvailableAt?.slice(0, 4),
    attrs.grandparentOriginallyAvailableAt?.slice(0, 4)
  ];
  const year = candidates
    .map(value => Number(value))
    .find(value => Number.isInteger(value) && value >= 1900 && value <= 2100);
  return year || null;
}

function applyYear(track, year) {
  track.year = year;
  track.decade = year ? Math.floor(year / 10) * 10 : null;
  return track;
}

function parseTracks(xml) {
  const tracks = [];
  const pattern = /<(?:Track|Metadata)\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:Track|Metadata)>)/g;
  let match;
  while ((match = pattern.exec(xml))) {
    const attrs = parseAttrs(match[1]);
    if (attrs.type && attrs.type !== "track") continue;
    const inner = match[2] || "";
    const genres = [];
    const genrePattern = /<Genre\b([^>]*)\/?>/g;
    let genreMatch;
    while ((genreMatch = genrePattern.exec(inner))) {
      const genre = parseAttrs(genreMatch[1]);
      if (genre.tag) genres.push(genre.tag);
    }

    const year = parseYear(attrs);
    tracks.push(applyYear({
      ratingKey: attrs.ratingKey,
      parentRatingKey: attrs.parentRatingKey,
      key: attrs.key,
      title: attrs.title || "Untitled track",
      artist: attrs.grandparentTitle || attrs.originalTitle || "Unknown artist",
      album: attrs.parentTitle || "Unknown album",
      year,
      decade: year ? Math.floor(year / 10) * 10 : null,
      genres,
      duration: Number(attrs.duration || 0),
      playCount: Number(attrs.viewCount || attrs.playCount || 0),
      rating: Number(attrs.userRating || attrs.rating || 0),
      addedAt: Number(attrs.addedAt || 0)
    }, year));
  }
  return tracks.filter(track => track.ratingKey);
}

function parseMetadataYear(xml) {
  const match = xml.match(/<(?:Directory|Metadata)\b([^>]*)/);
  return parseYear(parseAttrs(match?.[1] || ""));
}

function parsePlaylistKey(xml) {
  const match = xml.match(/<(?:Playlist|Metadata)\b([^>]*)/);
  if (!match) return null;
  return parseAttrs(match[1]).ratingKey || null;
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function trackCacheKey(provider, track) {
  return `${provider}:${normalizeKey(track.artist)}:${normalizeKey(track.title)}`;
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.error?.message || payload.error || response.statusText;
    throw new Error(`${response.status} ${detail}`);
  }
  return payload;
}

async function getDeezerPopularity(track) {
  const url = new URL("https://api.deezer.com/search/track");
  url.searchParams.set("q", `${track.artist} ${track.title}`);
  url.searchParams.set("limit", "1");
  const payload = await jsonRequest(url);
  const match = payload.data?.[0];
  return {
    provider: "deezer",
    score: Number(match?.rank || 0),
    label: match?.rank ? `${Number(match.rank).toLocaleString()} rank` : "No rank found"
  };
}

async function getLastFmPopularity(track, credentials = {}) {
  const apiKey = credentials.lastfmApiKey || process.env.LASTFM_API_KEY;
  if (!apiKey) throw new Error("Last.fm API key is required.");
  const url = new URL("https://ws.audioscrobbler.com/2.0/");
  url.searchParams.set("method", "track.getInfo");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("artist", track.artist);
  url.searchParams.set("track", track.title);
  url.searchParams.set("format", "json");
  url.searchParams.set("autocorrect", "1");
  const payload = await jsonRequest(url);
  const listeners = Number(payload.track?.listeners || 0);
  return {
    provider: "lastfm",
    score: listeners,
    label: listeners ? `${listeners.toLocaleString()} listeners` : "No listener count found"
  };
}

async function getSpotifyAccessToken(credentials = {}) {
  const clientId = credentials.spotifyClientId || process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = credentials.spotifyClientSecret || process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Spotify client ID and client secret are required.");
  }

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  const token = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const payload = await jsonRequest("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });
  return payload.access_token;
}

async function getSpotifyPopularity(track, credentials = {}) {
  const accessToken = await getSpotifyAccessToken(credentials);
  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set("type", "track");
  url.searchParams.set("limit", "1");
  url.searchParams.set("q", `track:${track.title} artist:${track.artist}`);
  const payload = await jsonRequest(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  const match = payload.tracks?.items?.[0];
  return {
    provider: "spotify",
    score: Number(match?.popularity || 0),
    label: match ? `${match.popularity}/100 popularity` : "No popularity found"
  };
}

async function getPopularity(provider, track, credentials = {}) {
  if (!provider || provider === "plex") {
    return { provider: "plex", score: track.playCount, label: `${track.playCount} Plex plays` };
  }

  const cacheKey = trackCacheKey(provider, track);
  if (providerCache.has(cacheKey)) return providerCache.get(cacheKey);

  let result;
  if (provider === "deezer") result = await getDeezerPopularity(track);
  else if (provider === "lastfm") result = await getLastFmPopularity(track, credentials);
  else if (provider === "spotify") result = await getSpotifyPopularity(track, credentials);
  else throw new Error("Unknown popularity provider.");

  providerCache.set(cacheKey, result);
  return result;
}

function summarizeTracks(tracks) {
  const genres = new Map();
  const decades = new Map();
  tracks.forEach(track => {
    track.genres.forEach(genre => genres.set(genre, (genres.get(genre) || 0) + 1));
    if (track.decade) decades.set(String(track.decade), (decades.get(String(track.decade)) || 0) + 1);
  });

  const byCount = ([, a], [, b]) => b - a;
  return {
    total: tracks.length,
    genres: [...genres.entries()].sort(byCount).map(([name, count]) => ({ name, count })),
    decades: [...decades.entries()].sort(([a], [b]) => Number(a) - Number(b)).map(([name, count]) => ({ name, count }))
  };
}

async function filterTracks(tracks, filters, credentials = {}) {
  const genres = new Set((filters.genres || []).map(item => item.toLowerCase()));
  const decades = new Set((filters.decades || []).map(String));
  const minPlays = Number(filters.minPlays || 0);
  const maxTracks = Math.max(1, Math.min(Number(filters.maxTracks || 100), 500));
  const provider = filters.popularityProvider || "plex";

  let result = tracks.filter(track => {
    const genreMatch = !genres.size || track.genres.some(genre => genres.has(genre.toLowerCase()));
    const decadeMatch = !decades.size || decades.has(String(track.decade));
    const playMatch = track.playCount >= minPlays;
    return genreMatch && decadeMatch && playMatch;
  });

  if (filters.popularOnly && provider !== "plex") {
    const enriched = [];
    for (const track of result.slice(0, Math.max(maxTracks * 4, 50))) {
      try {
        const popularity = await getPopularity(provider, track, credentials);
        enriched.push({ ...track, popularity });
      } catch {
        enriched.push({ ...track, popularity: { provider, score: 0, label: "Lookup failed" } });
      }
    }
    result = enriched.sort((a, b) => (b.popularity.score - a.popularity.score) || (b.playCount - a.playCount) || (b.rating - a.rating));
  } else if (filters.popularOnly) {
    result = result.sort((a, b) => (b.playCount - a.playCount) || (b.rating - a.rating) || (b.addedAt - a.addedAt));
  } else {
    result = result.sort((a, b) => a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album) || a.title.localeCompare(b.title));
  }

  return result.slice(0, maxTracks);
}

function createJob(config) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const job = {
    id,
    config,
    status: "running",
    progress: 0,
    message: "Starting sync",
    tracks: [],
    error: null,
    summary: null,
    listeners: new Set()
  };
  jobs.set(id, job);
  runSync(job).catch(error => {
    updateJob(job, { status: "error", error: error.message, message: error.message });
  });
  return job;
}

function updateJob(job, patch) {
  Object.assign(job, patch);
  const event = `data: ${JSON.stringify({
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
    summary: job.summary
  })}\n\n`;
  job.listeners.forEach(listener => listener.write(event));
}

async function runSync(job) {
  updateJob(job, { progress: 8, message: "Contacting Plex library" });
  const size = 250;
  let start = 0;
  let totalSize = null;
  const tracks = [];

  while (totalSize === null || start < totalSize) {
    const xml = await plexRequest(job.config, `/library/sections/${encodeURIComponent(job.config.sectionKey)}/all`, {
      type: "10",
      "X-Plex-Container-Start": start,
      "X-Plex-Container-Size": size
    });

    const containerSize = Number(xml.match(/\btotalSize="(\d+)"/)?.[1] || xml.match(/\bsize="(\d+)"/)?.[1] || 0);
    totalSize = totalSize || containerSize || start + size;
    const pageTracks = parseTracks(xml);
    tracks.push(...pageTracks);
    start += size;

    const ratio = totalSize ? Math.min(start / totalSize, 1) : 0.5;
    updateJob(job, {
      progress: Math.max(12, Math.round(ratio * 88)),
      message: `Synced ${tracks.length} tracks`
    });

    if (!pageTracks.length && start > totalSize) break;
  }

  await hydrateMissingYears(job, tracks);

  job.tracks = tracks;
  db.tracks = tracks;
  db.summary = summarizeTracks(tracks);
  saveDb();
  updateJob(job, {
    status: "complete",
    progress: 100,
    message: `Sync complete: ${tracks.length} tracks ready`,
    summary: db.summary
  });
}

async function hydrateMissingYears(job, tracks) {
  const missingTracks = tracks.filter(track => !track.year && track.parentRatingKey);
  if (!missingTracks.length) return;

  const albumKeys = [...new Set(missingTracks.map(track => track.parentRatingKey))];
  const albumYears = new Map();
  updateJob(job, {
    progress: 90,
    message: `Resolving album years for ${missingTracks.length} tracks`
  });

  for (let index = 0; index < albumKeys.length; index += 1) {
    const albumKey = albumKeys[index];
    try {
      const xml = await plexRequest(job.config, `/library/metadata/${encodeURIComponent(albumKey)}`);
      const year = parseMetadataYear(xml);
      if (year) albumYears.set(albumKey, year);
    } catch {
      albumYears.set(albumKey, null);
    }

    if (index % 20 === 0 || index === albumKeys.length - 1) {
      updateJob(job, {
        progress: Math.min(98, 90 + Math.round(((index + 1) / albumKeys.length) * 8)),
        message: `Resolved years for ${index + 1} of ${albumKeys.length} albums`
      });
    }
  }

  tracks.forEach(track => {
    if (!track.year && albumYears.get(track.parentRatingKey)) {
      applyYear(track, albumYears.get(track.parentRatingKey));
    }
  });
}

async function handleApi(req, res, pathname) {
  try {
    if (req.method === "GET" && pathname === "/api/config") {
      sendJson(res, 200, publicConfig());
      return;
    }

    if (req.method === "POST" && pathname === "/api/providers/test") {
      const body = await readBody(req);
      const provider = body.provider;
      db.provider = provider || db.provider;
      saveDb();
      const sample = { artist: "Daft Punk", title: "Get Lucky", playCount: 0 };
      const result = await getPopularity(provider, sample, body.credentials || {});
      sendJson(res, 200, {
        provider,
        ok: true,
        message: `${provider} returned ${result.label} for ${sample.artist} - ${sample.title}.`,
        result
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/connect") {
      const body = await readBody(req);
      const config = resolvePlexConfig(body);
      if (!config.baseUrl || !config.token) {
        sendJson(res, 400, { error: "Plex URL and token are required. Set them in the UI or Docker environment." });
        return;
      }
      const xml = await plexRequest(config, "/library/sections");
      const libraries = parseSections(xml);
      db.connection.baseUrl = config.baseUrl;
      db.libraries = libraries;
      if (!db.connection.sectionKey && libraries[0]) db.connection.sectionKey = libraries[0].key;
      saveDb();
      sendJson(res, 200, { libraries, config: publicConfig() });
      return;
    }

    if (req.method === "POST" && pathname === "/api/sync") {
      const body = await readBody(req);
      const config = resolvePlexConfig(body);
      if (!config.baseUrl || !config.token || !config.sectionKey) {
        sendJson(res, 400, { error: "Plex URL, token, and music library are required." });
        return;
      }
      db.connection.baseUrl = config.baseUrl;
      db.connection.sectionKey = config.sectionKey;
      saveDb();
      const job = createJob(config);
      sendJson(res, 202, { jobId: job.id });
      return;
    }

    const eventMatch = pathname.match(/^\/api\/sync\/([^/]+)\/events$/);
    if (req.method === "GET" && eventMatch) {
      const job = jobs.get(eventMatch[1]);
      if (!job) {
        sendJson(res, 404, { error: "Sync job was not found." });
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });
      job.listeners.add(res);
      updateJob(job, {});
      req.on("close", () => job.listeners.delete(res));
      return;
    }

    const syncMatch = pathname.match(/^\/api\/sync\/([^/]+)$/);
    if (req.method === "GET" && syncMatch) {
      const job = jobs.get(syncMatch[1]);
      if (!job) {
        sendJson(res, 404, { error: "Sync job was not found." });
        return;
      }
      sendJson(res, 200, {
        id: job.id,
        status: job.status,
        progress: job.progress,
        message: job.message,
        error: job.error,
        summary: job.summary
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/preview") {
      const body = await readBody(req);
      const job = jobs.get(body.jobId);
      if (!job || job.status !== "complete") {
        sendJson(res, 400, { error: "Complete a sync before previewing a playlist." });
        return;
      }
      const tracks = await filterTracks(job.tracks, body.filters || {}, body.credentials || {});
      sendJson(res, 200, { tracks, count: tracks.length });
      return;
    }

    if (req.method === "POST" && pathname === "/api/playlists") {
      const body = await readBody(req);
      const job = jobs.get(body.jobId);
      if (!job || job.status !== "complete") {
        sendJson(res, 400, { error: "Complete a sync before creating a playlist." });
        return;
      }
      const title = String(body.title || "").trim();
      if (!title) {
        sendJson(res, 400, { error: "Playlist name is required." });
        return;
      }
      const tracks = await filterTracks(job.tracks, body.filters || {}, body.credentials || {});
      if (!tracks.length) {
        sendJson(res, 400, { error: "No tracks matched those filters." });
        return;
      }

      const machineXml = await plexRequest(job.config, "/");
      const machineId = parseAttrs(machineXml.match(/<MediaContainer\b([^>]*)/)?.[1] || "").machineIdentifier;
      if (!machineId) throw new Error("Could not read the Plex server machine identifier.");

      const createXml = await plexRequest(job.config, "/playlists", {
        type: "audio",
        title,
        smart: "0",
        uri: `server://${machineId}/com.plexapp.plugins.library/library/metadata/${tracks.map(track => track.ratingKey).join(",")}`
      }, {
        method: "POST"
      });
      const playlistKey = parsePlaylistKey(createXml);
      const playlist = {
        title,
        count: tracks.length,
        playlistKey,
        createdAt: new Date().toISOString(),
        filters: body.filters || {}
      };
      db.playlists = [playlist, ...(db.playlists || [])].slice(0, 25);
      saveDb();
      sendJson(res, 201, { title, count: tracks.length, playlistKey });
      return;
    }

    sendJson(res, 404, { error: "API route was not found." });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url.pathname);
    return;
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Plex Playlist Studio is running at http://localhost:${PORT}`);
});
