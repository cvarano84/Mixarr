import http from "http";
import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from "prom-client";
import prisma from "./prisma";
import {
  effectiveBpmTrackWhere,
  noEffectiveBpmTrackWhere,
} from "./bpm";

/**
 * Prometheus metrics for Mixarr.
 *
 * Convention:
 *   - Counters end in `_total`.
 *   - Histograms are exposed in seconds and end in `_seconds`.
 *   - Gauges that count things end in `_total` too (these are point-in-time
 *     snapshots of DB state, not monotonic counters).
 *
 * Metrics are no-ops if no scraper ever hits /metrics; the cost of the
 * `.inc()` / `.observe()` calls in the hot paths is negligible.
 *
 * ---------------------------------------------------------------------------
 * Webpack chunk sharing — why this module pins everything on globalThis
 * ---------------------------------------------------------------------------
 * Next.js's standalone server build inlines this module into every chunk
 * that imports it. Without intervention each chunk ends up with its own
 * `new Registry()` and its own `Counter` / `Histogram` / `Gauge` instances.
 * The `/metrics` HTTP handler lives in the instrumentation chunk and only
 * ever exposes *its* Registry, so any `.inc()` / `.observe()` that happens
 * inside an API route, engine or provider chunk is invisible to Prometheus.
 *
 * To make the metrics module behave as a true singleton we pin the whole
 * bundle of instances on `globalThis` (the one object that's genuinely
 * shared across chunks in a single Node.js process). This is the same
 * trick the generated Prisma client uses for `globalThis.prismaGlobal`.
 *
 * The first chunk to load this module builds the bundle and registers the
 * default Node.js process metrics; every subsequent chunk picks up the
 * cached instances and re-exports them.
 */

const createMetricsBundle = () => {
  const registry = new Registry();
  registry.setDefaultLabels({ app: "mixarr" });

  // Node.js process / GC / event-loop metrics. Useful for debugging "logs
  // went quiet" symptoms - if event_loop_lag spikes, we're not actually
  // hung on an HTTP call, we're starved.
  collectDefaultMetrics({ register: registry });

  return {
    registry,

    // -----------------------------------------------------------------------
    // Engine metrics (one row processed = one observation)
    // -----------------------------------------------------------------------

    /**
     * Per-track outcome counter. Use to graph throughput, success rate and
     * failure rate over time.
     *   engine: popularity | audio_feature | bpm | tags
     *   result: success | not_found | rate_limited | error
     */
    trackAttemptsTotal: new Counter({
      name: "mixarr_track_attempts_total",
      help: "Tracks attempted by each enrichment engine, labeled by outcome",
      labelNames: ["engine", "result"],
      registers: [registry],
    }),

    /**
     * Per-track processing duration. The `_count` series of this histogram
     * is what you want for "how many records is each job doing over time"
     * (`rate(mixarr_track_duration_seconds_count[5m])`).
     */
    trackDurationSeconds: new Histogram({
      name: "mixarr_track_duration_seconds",
      help: "Per-track processing duration in seconds",
      labelNames: ["engine"],
      // Top three buckets (120 / 300 / 600s) are sized for the local BPM
      // engine: each track does an ffmpeg sample extract (default 180s of
      // audio, transcoded from Plex) followed by a local tempo analysis,
      // which routinely lands in the tens-of-seconds range and can stretch
      // past a minute on slow servers. The popularity / audio_feature /
      // tags engines all finish well inside the low buckets.
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600],
      registers: [registry],
    }),

    /**
     * Size of each batch the engine pulled from the work queue. Drops to 0
     * when the engine is fully drained.
     */
    engineBatchSize: new Histogram({
      name: "mixarr_engine_batch_size",
      help: "Number of tracks pulled per engine batch",
      labelNames: ["engine"],
      buckets: [0, 1, 10, 50, 100, 500, 1000, 2000, 5000, 10000],
      registers: [registry],
    }),

    // -----------------------------------------------------------------------
    // Provider metrics (one upstream HTTP call = one observation)
    // -----------------------------------------------------------------------

    /**
     * Per-request outcome counter for each upstream provider API.
     *   provider: audiodb | deezer | discogs | lastfm | musicbrainz | spotify
     *   result: success | not_found | timeout | rate_limited | error
     */
    providerRequestsTotal: new Counter({
      name: "mixarr_provider_requests_total",
      help: "Outbound provider API requests, labeled by provider and outcome",
      labelNames: ["provider", "result"],
      registers: [registry],
    }),

    providerRequestDurationSeconds: new Histogram({
      name: "mixarr_provider_request_duration_seconds",
      help: "Provider API request duration in seconds",
      labelNames: ["provider"],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15],
      registers: [registry],
    }),

    /**
     * Counts Last.fm responses where the API rewrote the artist and/or
     * track before performing the lookup. Only incremented when
     * LASTFM_AUTOCORRECT is enabled, so a flat-zero line is the
     * expected "feature off" state. Useful for spotting how often
     * Plex metadata disagrees with Last.fm's canonical names.
     *   field: artist | track | both
     */
    lastfmAutocorrectionsTotal: new Counter({
      name: "mixarr_lastfm_autocorrections_total",
      help: "Last.fm responses where autocorrect rewrote the artist, track, or both",
      labelNames: ["field"],
      registers: [registry],
    }),

    // -----------------------------------------------------------------------
    // Plex library sync metrics
    // -----------------------------------------------------------------------

    syncRunsTotal: new Counter({
      name: "mixarr_sync_runs_total",
      help: "Library syncs from Plex, labeled by result",
      labelNames: ["result"], // success | failed
      registers: [registry],
    }),

    syncDurationSeconds: new Histogram({
      name: "mixarr_sync_duration_seconds",
      help: "Library sync duration in seconds",
      buckets: [10, 30, 60, 120, 300, 600, 1800, 3600],
      registers: [registry],
    }),

    // -----------------------------------------------------------------------
    // Nightly pipeline metrics
    // -----------------------------------------------------------------------

    pipelineRunsTotal: new Counter({
      name: "mixarr_pipeline_runs_total",
      help: "Nightly pipeline invocations, labeled by result",
      labelNames: ["result"], // success | failed | timeout | skipped
      registers: [registry],
    }),

    pipelineDurationSeconds: new Histogram({
      name: "mixarr_pipeline_duration_seconds",
      help: "Nightly pipeline total duration in seconds",
      buckets: [60, 300, 600, 1800, 3600, 7200, 14400, 21600],
      registers: [registry],
    }),

    // -----------------------------------------------------------------------
    // Playlist feature metrics (generation / export / refresh)
    // -----------------------------------------------------------------------

    /**
     * Playlist generation outcomes. Triggered on every Builder UI run as
     * well as every refresh of a saved playlist (which calls the same
     * generate path). Use rate() to see how heavily the feature is used
     * and divide failure / success for an error rate.
     *   result: success | failed
     */
    playlistGenerationsTotal: new Counter({
      name: "mixarr_playlist_generations_total",
      help: "Calls to generatePlaylistTracks, labeled by outcome",
      labelNames: ["result"],
      registers: [registry],
    }),

    playlistGenerationDurationSeconds: new Histogram({
      name: "mixarr_playlist_generation_duration_seconds",
      help: "Playlist generation duration in seconds (DB query + dedupe + annotation)",
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
      registers: [registry],
    }),

    /**
     * Playlist export to Plex outcomes. This is the highest-risk hop in
     * the playlist pipeline because it makes external HTTP calls to the
     * user's Plex server. Pair with the duration histogram below to
     * spot a slow/sleeping Plex via the latency tail.
     *   result: success | failed
     */
    playlistExportsTotal: new Counter({
      name: "mixarr_playlist_exports_total",
      help: "Playlist exports to Plex, labeled by outcome",
      labelNames: ["result"],
      registers: [registry],
    }),

    playlistExportDurationSeconds: new Histogram({
      name: "mixarr_playlist_export_duration_seconds",
      help: "End-to-end playlist-to-Plex export duration in seconds",
      buckets: [0.1, 0.5, 1, 2, 5, 10, 15, 30, 60],
      registers: [registry],
    }),

    /**
     * Saved-playlist refresh outcomes, split by trigger source.
     *   mode: manual | auto
     *   result: success | failed | skipped_locked | skipped_not_exported
     *
     * `skipped_locked` ticks when the per-rule lock from
     * refreshSavedPlaylist refuses a second concurrent run; a high rate
     * means manual clicks are colliding with the nightly cron and the
     * UI should probably disable the button while the cron is in flight.
     */
    playlistRefreshesTotal: new Counter({
      name: "mixarr_playlist_refreshes_total",
      help: "Saved-playlist refreshes, labeled by trigger mode and outcome",
      labelNames: ["mode", "result"],
      registers: [registry],
    }),

    playlistRefreshDurationSeconds: new Histogram({
      name: "mixarr_playlist_refresh_duration_seconds",
      help: "Saved-playlist refresh duration in seconds",
      labelNames: ["mode"],
      buckets: [0.5, 1, 2, 5, 10, 15, 30, 60, 120],
      registers: [registry],
    }),

    // -----------------------------------------------------------------------
    // State gauges (point-in-time snapshots of the DB, refreshed on scrape)
    // -----------------------------------------------------------------------

    tracksTotal: new Gauge({
      name: "mixarr_tracks_total",
      help: "Total tracks indexed from Plex",
      registers: [registry],
    }),

    artistsTotal: new Gauge({
      name: "mixarr_artists_total",
      help: "Total artists indexed from Plex",
      registers: [registry],
    }),

    albumsTotal: new Gauge({
      name: "mixarr_albums_total",
      help: "Total albums indexed from Plex",
      registers: [registry],
    }),

    /**
     * Enrichment coverage. `kind` is which enrichment, `status` distinguishes
     * "we have real data" from "we tried and got nothing" (marker rows).
     *   kind: popularity | audio_feature | bpm | tags
     *   status: success | not_found
     */
    enrichmentTracksTotal: new Gauge({
      name: "mixarr_enrichment_tracks_total",
      help: "Tracks per enrichment kind and status",
      labelNames: ["kind", "status"],
      registers: [registry],
    }),

    /**
     * Saved playlists currently configured, split by whether they're
     * opted in to the nightly auto-refresh.
     *   auto_refresh: enabled | disabled
     */
    savedPlaylistsTotal: new Gauge({
      name: "mixarr_saved_playlists_total",
      help: "Saved playlist rules currently configured",
      labelNames: ["auto_refresh"],
      registers: [registry],
    }),

    /**
     * Blocked tracks across all users. A non-zero value tells the
     * operator the Block button has actually been used, which is also
     * useful as a signal that the new feature is being adopted.
     */
    blockedTracksTotal: new Gauge({
      name: "mixarr_blocked_tracks_total",
      help: "Tracks currently blocked from generated playlists",
      registers: [registry],
    }),

    // -----------------------------------------------------------------------
    // Spotify rate-limit visibility
    // -----------------------------------------------------------------------

    spotifyBackoffSecondsRemaining: new Gauge({
      name: "mixarr_spotify_backoff_seconds_remaining",
      help: "Seconds remaining on the persisted Spotify rate-limit backoff (0 if not rate-limited)",
      registers: [registry],
    }),
  };
};

type MetricsBundle = ReturnType<typeof createMetricsBundle>;

const globalForMetrics = globalThis as unknown as {
  __mixarrMetrics?: MetricsBundle;
};

// ---------------------------------------------------------------------------
// Canonical label value sets, kept in lock-step with the `.inc()` / `.observe()`
// callers (engines, providers, syncEngine, instrumentation pipeline). These
// drive the zero-seeding loop below; if you add a new engine / provider /
// result outcome, add it here too or its Grafana series will show "No data"
// until the first real event of that kind.
// ---------------------------------------------------------------------------
const ENGINES = ["popularity", "audio_feature", "bpm", "tags"] as const;
const ENGINE_RESULTS = ["success", "not_found", "rate_limited", "error"] as const;
const PROVIDERS = ["audiodb", "deezer", "discogs", "lastfm", "musicbrainz", "spotify"] as const;
const PROVIDER_RESULTS = ["success", "not_found", "timeout", "rate_limited", "error"] as const;
const SYNC_RESULTS = ["success", "failed"] as const;
const PIPELINE_RESULTS = ["success", "failed", "timeout", "skipped"] as const;
const AUTOCORRECT_FIELDS = ["artist", "track", "both"] as const;
const PLAYLIST_GENERATION_RESULTS = ["success", "failed"] as const;
const PLAYLIST_EXPORT_RESULTS = ["success", "failed"] as const;
const PLAYLIST_REFRESH_MODES = ["manual", "auto"] as const;
const PLAYLIST_REFRESH_RESULTS = ["success", "failed", "skipped_locked", "skipped_not_exported"] as const;

// Cache the whole bundle on globalThis so every chunk that imports this
// module resolves the same Registry + metric instances. See the long
// comment at the top of the file for why this is necessary.
const metrics: MetricsBundle =
  globalForMetrics.__mixarrMetrics ?? createMetricsBundle();
if (!globalForMetrics.__mixarrMetrics) {
  globalForMetrics.__mixarrMetrics = metrics;

  // -------------------------------------------------------------------------
  // Zero-seed every known label combination so Grafana shows a flat zero
  // line (not "No data") for series that haven't been touched yet.
  //
  // Why this matters: prom-client only materializes a labeled time series
  // after the first `.inc()` / `.observe()` for that exact label combo.
  // Counter series that never fire (e.g. `result="failed"`, the entire
  // nightly pipeline before its 3am cron tick, or any engine in a
  // freshly-restarted container) simply don't exist at scrape time, and
  // Grafana renders them as "No data". The Counter API allows seeding via
  // `.inc(labels, 0)` and the Histogram API provides `.zero(labels)`
  // (prom-client >=15), both of which materialize the child without
  // recording a real event.
  //
  // Note: container restarts reset all counters back to 0 - this seeding
  // makes that visible (as a 0 line) instead of invisible (as "No data").
  // -------------------------------------------------------------------------

  for (const field of AUTOCORRECT_FIELDS) {
    metrics.lastfmAutocorrectionsTotal.inc({ field }, 0);
  }

  for (const result of SYNC_RESULTS) {
    metrics.syncRunsTotal.inc({ result }, 0);
  }
  metrics.syncDurationSeconds.zero({});

  for (const result of PIPELINE_RESULTS) {
    metrics.pipelineRunsTotal.inc({ result }, 0);
  }
  metrics.pipelineDurationSeconds.zero({});

  for (const engine of ENGINES) {
    for (const result of ENGINE_RESULTS) {
      metrics.trackAttemptsTotal.inc({ engine, result }, 0);
    }
    metrics.trackDurationSeconds.zero({ engine });
    metrics.engineBatchSize.zero({ engine });
  }

  for (const provider of PROVIDERS) {
    for (const result of PROVIDER_RESULTS) {
      metrics.providerRequestsTotal.inc({ provider, result }, 0);
    }
    metrics.providerRequestDurationSeconds.zero({ provider });
  }

  for (const result of PLAYLIST_GENERATION_RESULTS) {
    metrics.playlistGenerationsTotal.inc({ result }, 0);
  }
  metrics.playlistGenerationDurationSeconds.zero({});

  for (const result of PLAYLIST_EXPORT_RESULTS) {
    metrics.playlistExportsTotal.inc({ result }, 0);
  }
  metrics.playlistExportDurationSeconds.zero({});

  for (const mode of PLAYLIST_REFRESH_MODES) {
    for (const result of PLAYLIST_REFRESH_RESULTS) {
      metrics.playlistRefreshesTotal.inc({ mode, result }, 0);
    }
    metrics.playlistRefreshDurationSeconds.zero({ mode });
  }

  // Seed the saved-playlist gauge label combos. The blockedTracksTotal
  // gauge is unlabeled, so prom-client materializes it the first time
  // refreshStateGauges() runs - no explicit zeroing needed.
  metrics.savedPlaylistsTotal.set({ auto_refresh: "enabled" }, 0);
  metrics.savedPlaylistsTotal.set({ auto_refresh: "disabled" }, 0);
  metrics.blockedTracksTotal.set(0);
}

export const registry = metrics.registry;
export const trackAttemptsTotal = metrics.trackAttemptsTotal;
export const trackDurationSeconds = metrics.trackDurationSeconds;
export const engineBatchSize = metrics.engineBatchSize;
export const providerRequestsTotal = metrics.providerRequestsTotal;
export const providerRequestDurationSeconds = metrics.providerRequestDurationSeconds;
export const lastfmAutocorrectionsTotal = metrics.lastfmAutocorrectionsTotal;
export const syncRunsTotal = metrics.syncRunsTotal;
export const syncDurationSeconds = metrics.syncDurationSeconds;
export const pipelineRunsTotal = metrics.pipelineRunsTotal;
export const pipelineDurationSeconds = metrics.pipelineDurationSeconds;
export const playlistGenerationsTotal = metrics.playlistGenerationsTotal;
export const playlistGenerationDurationSeconds = metrics.playlistGenerationDurationSeconds;
export const playlistExportsTotal = metrics.playlistExportsTotal;
export const playlistExportDurationSeconds = metrics.playlistExportDurationSeconds;
export const playlistRefreshesTotal = metrics.playlistRefreshesTotal;
export const playlistRefreshDurationSeconds = metrics.playlistRefreshDurationSeconds;
export const tracksTotal = metrics.tracksTotal;
export const artistsTotal = metrics.artistsTotal;
export const albumsTotal = metrics.albumsTotal;
export const enrichmentTracksTotal = metrics.enrichmentTracksTotal;
export const savedPlaylistsTotal = metrics.savedPlaylistsTotal;
export const blockedTracksTotal = metrics.blockedTracksTotal;
export const spotifyBackoffSecondsRemaining = metrics.spotifyBackoffSecondsRemaining;

// ---------------------------------------------------------------------------
// State refresh - called from the /metrics handler so the gauges are fresh
// but throttled so a hostile scraper can't DOS the DB.
// ---------------------------------------------------------------------------

const SPOTIFY_FAILURE_KEY = "spotify_token_failure_time";
const REFRESH_INTERVAL_MS = 15_000;
let lastRefreshAt = 0;
let inflightRefresh: Promise<void> | null = null;

export const refreshStateGauges = async (): Promise<void> => {
  const now = Date.now();
  if (now - lastRefreshAt < REFRESH_INTERVAL_MS) return;
  if (inflightRefresh) return inflightRefresh;
  lastRefreshAt = now;

  inflightRefresh = (async () => {
    try {
      const [
        totalTracks,
        totalArtists,
        totalAlbums,
        popularitySuccess,
        popularityNotFound,
        audioFeatureSuccess,
        audioFeatureNotFound,
        audioFeatureBpm,
        audioFeatureBpmNotFound,
        tagsAttempted,
        tagsWithGenre,
        savedPlaylistsAuto,
        savedPlaylistsManual,
        blockedTracks,
        spotifyFailureRow,
      ] = await Promise.all([
        prisma.track.count({ where: { syncStatus: "active" } }),
        prisma.artist.count({ where: { syncStatus: "active" } }),
        prisma.album.count({ where: { syncStatus: "active" } }),
        prisma.popularity.count({ where: { provider: { not: "not_found" }, track: { syncStatus: "active" } } }),
        prisma.popularity.count({ where: { provider: "not_found", track: { syncStatus: "active" } } }),
        prisma.audioFeature.count({
          where: {
            track: { syncStatus: "active" },
            OR: [
              { energy: { not: null } },
              { valence: { not: null } },
              { danceability: { not: null } },
              { tempo: { not: null } },
            ],
          },
        }),
        prisma.audioFeature.count({
          where: { energy: null, valence: null, danceability: null, tempo: null, track: { syncStatus: "active" } },
        }),
        prisma.track.count({ where: { AND: [{ syncStatus: "active" }, effectiveBpmTrackWhere()] } }),
        prisma.track.count({ where: { AND: [{ syncStatus: "active" }, noEffectiveBpmTrackWhere()] } }),
        prisma.track.count({ where: { syncStatus: "active", tagsSyncedAt: { not: null } } }),
        prisma.track.count({
          where: { syncStatus: "active", tagsSyncedAt: { not: null }, tags: { some: { type: "genre" } } },
        }),
        prisma.playlistRule.count({ where: { autoRefresh: true } }),
        prisma.playlistRule.count({ where: { autoRefresh: false } }),
        prisma.blockedTrack.count(),
        prisma.systemState.findUnique({ where: { key: SPOTIFY_FAILURE_KEY } }),
      ]);

      tracksTotal.set(totalTracks);
      artistsTotal.set(totalArtists);
      albumsTotal.set(totalAlbums);

      enrichmentTracksTotal.set({ kind: "popularity", status: "success" }, popularitySuccess);
      enrichmentTracksTotal.set({ kind: "popularity", status: "not_found" }, popularityNotFound);
      enrichmentTracksTotal.set({ kind: "audio_feature", status: "success" }, audioFeatureSuccess);
      enrichmentTracksTotal.set({ kind: "audio_feature", status: "not_found" }, audioFeatureNotFound);
      enrichmentTracksTotal.set({ kind: "bpm", status: "success" }, audioFeatureBpm);
      enrichmentTracksTotal.set({ kind: "bpm", status: "not_found" }, audioFeatureBpmNotFound);
      enrichmentTracksTotal.set({ kind: "tags", status: "success" }, tagsWithGenre);
      enrichmentTracksTotal.set({ kind: "tags", status: "not_found" }, tagsAttempted - tagsWithGenre);

      savedPlaylistsTotal.set({ auto_refresh: "enabled" }, savedPlaylistsAuto);
      savedPlaylistsTotal.set({ auto_refresh: "disabled" }, savedPlaylistsManual);
      blockedTracksTotal.set(blockedTracks);

      if (spotifyFailureRow) {
        const expiry = Number(spotifyFailureRow.value);
        const remaining = Math.max(0, Math.round((expiry - Date.now()) / 1000));
        spotifyBackoffSecondsRemaining.set(remaining);
      } else {
        spotifyBackoffSecondsRemaining.set(0);
      }
    } catch (e) {
      console.error("[Metrics] Failed to refresh state gauges:", e);
    } finally {
      inflightRefresh = null;
    }
  })();

  return inflightRefresh;
};

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

/**
 * Start a dedicated HTTP server exposing /metrics on the given port.
 * Returns null (and does nothing) if port <= 0, which is how callers opt
 * out via the METRICS_PORT env var.
 */
export const startMetricsServer = (port: number): http.Server | null => {
  if (!Number.isFinite(port) || port <= 0) {
    console.log("[Metrics] Prometheus endpoint disabled (METRICS_PORT is 0 or unset)");
    return null;
  }

  const server = http.createServer(async (req, res) => {
    const url = req.url || "/";
    if (url === "/metrics") {
      try {
        await refreshStateGauges();
        res.setHeader("Content-Type", registry.contentType);
        res.end(await registry.metrics());
      } catch (e: any) {
        res.statusCode = 500;
        res.end(`Failed to collect metrics: ${e?.message || e}`);
      }
      return;
    }
    if (url === "/" || url === "/health") {
      res.setHeader("Content-Type", "text/plain");
      res.end("OK - mixarr metrics endpoint. See /metrics\n");
      return;
    }
    res.statusCode = 404;
    res.end("Not found\n");
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`[Metrics] Prometheus endpoint listening on 0.0.0.0:${port}/metrics`);
  });
  server.on("error", err => {
    console.error("[Metrics] HTTP server error:", err);
  });

  // Be a good neighbor on shutdown.
  const shutdown = () => {
    server.close(() => {
      console.log("[Metrics] HTTP server closed");
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  return server;
};
