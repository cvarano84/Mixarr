"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Download,
  FileJson, HeartPulse, Loader2, Music, RefreshCw, Search, ShieldAlert, Trash2,
} from "lucide-react";
import styles from "./library-health.module.css";

type HealthLibrary = {
  id: string;
  name: string;
  server: { id: string; name: string };
  status: "healthy" | "warning" | "error";
  activeTracks: number;
  missingTracks: number;
  missingAlbums: number;
  missingArtists: number;
  tracksWithBpm: number;
  bpmApi: number;
  bpmLocal: number;
  bpmImported: number;
  missingBpm: number;
  bpmNoData: number;
  bpmFailed: number;
  bpmExtractionFailed: number;
  bpmAnalyzerFailed: number;
  bpmTooShort: number;
  bpmPendingBackfill: number;
  audioFeaturesComplete: number;
  audioFeaturesMissing: number;
  audioFeaturesApi: number;
  audioFeaturesLocal: number;
  audioFeaturesHeuristic: number;
  audioFeaturesPartial: number;
  audioFeaturesNoData: number;
  audioFeaturesFailed: number;
  audioFeaturesExtractionFailed: number;
  audioFeaturesAnalyzerFailed: number;
  audioFeaturesTooShort: number;
  bpmProviderMode: string;
  audioFeatureProviderMode: string;
  tracksWithGenres: number;
  missingGenres: number;
  genreNoData: number;
  genreFailed: number;
  pendingGenreBackfill: number;
  tracksWithPopularity: number;
  missingPopularity: number;
  popularityNoData: number;
  popularityFailed: number;
  pendingPopularityBackfill: number;
  lastFullSyncAt: string | null;
  lastReconciliationAt: string | null;
  lastSyncStatus: string;
  lastSyncRunId: string | null;
  lastSyncError: string | null;
  plexReportedTrackCount: number | null;
  mixarrActiveTrackCount: number;
  difference: number | null;
};

type MissingTrack = {
  id: string;
  title: string;
  ratingKey: string;
  mediaPath: string | null;
  lastSeenAt: string | null;
  missingSince: string | null;
  lastSeenSyncId: string | null;
  bpmStatus: string;
  library: { id: string; name: string };
  artist: { title: string };
  album: { title: string };
};

type BpmFilter = "tracks_with_bpm" | "api_bpm" | "local_bpm" | "imported_bpm" | "missing_bpm" | "bpm_no_data" | "bpm_failed" | "extraction_failed" | "analyzer_failed" | "too_short" | "pending_backfill" | "pending_bpm";
type AudioFilter = "missing_audio_features" | "api_audio_features" | "local_audio_features" | "heuristic_audio_features" | "partial_audio_features" | "audio_feature_no_data" | "audio_feature_failed" | "extraction_failed" | "analyzer_failed" | "too_short" | "pending_audio_features";
type RetryProviderMode = "configured" | "api_only" | "local_only" | "force_local";
type MetadataSection = "genres" | "popularity";
type GenreFilter = "tracks_with_genres" | "missing_genres" | "genre_no_data" | "genre_failed" | "pending_genre_backfill";
type PopularityFilter = "tracks_with_popularity" | "missing_popularity" | "popularity_no_data" | "popularity_failed" | "pending_popularity_backfill";
type MetadataFilter = GenreFilter | PopularityFilter;

type BpmTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  library: { id: string; name: string };
  duration: number | null;
  mediaPath: string | null;
  ratingKey: string;
  effectiveBpm: number | null;
  apiBpm: number | null;
  localBpm: number | null;
  bpmSource: string | null;
  bpmConfidence: number | null;
  bpmAnalysisScope: string | null;
  bpmAnalysisStatus: string;
  bpmFailureReason: string | null;
  bpmAnalyzedAt: string | null;
  lastSeenAt: string | null;
  syncStatus: string;
};

type AudioFeatureTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  library: { id: string; name: string };
  duration: number | null;
  mediaPath: string | null;
  ratingKey: string;
  energy: number | null;
  mood: number | null;
  bpm: number | null;
  danceability: number | null;
  acousticness: number | null;
  api: { energy: number | null; mood: number | null; danceability: number | null; acousticness: number | null; loudness: number | null };
  local: { energy: number | null; mood: number | null; danceability: number | null; acousticness: number | null; loudness: number | null };
  source: string | null;
  analysisScope: string | null;
  confidence: number | null;
  status: string;
  failureReason: string | null;
  analyzedAt: string | null;
  syncStatus: string;
};

type MetadataTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  library: { id: string; name: string };
  duration: number | null;
  mediaPath: string | null;
  ratingKey: string;
  genres: string[];
  genreStatus: string;
  genreFailureReason: string | null;
  genreAttemptedAt: string | null;
  popularityScore: number | null;
  popularitySource: string | null;
  popularityStatus: string;
  popularityFailureReason: string | null;
  popularityAttemptedAt: string | null;
  lastSeenAt: string | null;
  syncStatus: string;
};

type Filters = {
  libraryId: string;
  search: string;
  artist: string;
  album: string;
  missingSinceFrom: string;
  bpmStatus: string;
};

const initialFilters: Filters = { libraryId: "", search: "", artist: "", album: "", missingSinceFrom: "", bpmStatus: "" };

function formatNumber(value: number | null) {
  return value === null ? "â€”" : new Intl.NumberFormat().format(value);
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function labelBpm(status: string) {
  return ({ success: "BPM available", with_bpm: "BPM available", no_data: "No data", failed: "Failed", extraction_failed: "Extraction failed", analyzer_failed: "Analyzer failed", too_short: "Too short", pending: "Pending" } as Record<string, string>)[status] || status;
}

const bpmFilterLabels: Record<BpmFilter, string> = {
  tracks_with_bpm: "Tracks with BPM",
  api_bpm: "API BPM",
  local_bpm: "Local Essentia BPM",
  imported_bpm: "Imported/legacy BPM",
  missing_bpm: "Missing BPM",
  bpm_no_data: "BPM no data",
  bpm_failed: "BPM failed",
  extraction_failed: "Extraction failed",
  analyzer_failed: "Analyzer failed",
  too_short: "BPM too short",
  pending_backfill: "Pending backfill",
  pending_bpm: "Pending BPM",
};

const bpmEmptyMessages: Record<BpmFilter, string> = {
  tracks_with_bpm: "No active tracks have a valid BPM yet.",
  api_bpm: "No active tracks have API BPM yet.",
  local_bpm: "No active tracks have local Essentia BPM yet.",
  imported_bpm: "No active tracks have imported or legacy BPM yet.",
  missing_bpm: "Every active track has a valid BPM.",
  bpm_no_data: "No active tracks completed analysis without finding a BPM.",
  bpm_failed: "No active tracks have a terminal BPM failure.",
  extraction_failed: "No active tracks have an extraction failure.",
  analyzer_failed: "No active tracks have an analyzer failure.",
  too_short: "No active tracks are below the local BPM minimum duration.",
  pending_backfill: "No active tracks are waiting for BPM backfill.",
  pending_bpm: "No active tracks are waiting for BPM backfill.",
};

const audioFilterLabels: Record<AudioFilter, string> = {
  missing_audio_features: "Missing audio features",
  api_audio_features: "API audio features",
  local_audio_features: "Local Essentia",
  heuristic_audio_features: "Estimated/heuristic",
  partial_audio_features: "Partial audio features",
  audio_feature_no_data: "Audio no data",
  audio_feature_failed: "Audio failed",
  extraction_failed: "Extraction failed",
  analyzer_failed: "Analyzer failed",
  too_short: "Audio feature too short",
  pending_audio_features: "Pending audio features",
};

const audioEmptyMessages: Record<AudioFilter, string> = {
  missing_audio_features: "Every active track has complete audio features.",
  api_audio_features: "No active tracks have API audio features yet.",
  local_audio_features: "No active tracks have local Essentia audio features yet.",
  heuristic_audio_features: "No active tracks are using estimated audio-feature fields.",
  partial_audio_features: "No active tracks have partial audio features.",
  audio_feature_no_data: "No active tracks completed analysis without feature data.",
  audio_feature_failed: "No active tracks have terminal audio-feature failures.",
  extraction_failed: "No active tracks have audio extraction failures.",
  analyzer_failed: "No active tracks have Essentia analyzer failures.",
  too_short: "No active tracks are below the local audio-feature minimum duration.",
  pending_audio_features: "No active tracks are waiting for audio-feature backfill.",
};

const genreFilterLabels: Record<GenreFilter, string> = {
  tracks_with_genres: "Tracks with genres",
  missing_genres: "Missing genres",
  genre_no_data: "Genre no data",
  genre_failed: "Genre failed",
  pending_genre_backfill: "Pending genre backfill",
};

const popularityFilterLabels: Record<PopularityFilter, string> = {
  tracks_with_popularity: "Tracks with popularity",
  missing_popularity: "Missing popularity",
  popularity_no_data: "Popularity no data",
  popularity_failed: "Popularity failed",
  pending_popularity_backfill: "Pending popularity backfill",
};

const genreEmptyMessages: Record<GenreFilter, string> = {
  tracks_with_genres: "No active tracks have usable genres yet.",
  missing_genres: "Every active track has at least one usable genre.",
  genre_no_data: "No active tracks completed genre lookup without data.",
  genre_failed: "No active tracks have terminal genre lookup failures.",
  pending_genre_backfill: "No active tracks are waiting for genre backfill.",
};

const popularityEmptyMessages: Record<PopularityFilter, string> = {
  tracks_with_popularity: "No active tracks have valid popularity yet.",
  missing_popularity: "Every active track has a valid popularity score.",
  popularity_no_data: "No active tracks completed popularity lookup without data.",
  popularity_failed: "No active tracks have terminal popularity lookup failures.",
  pending_popularity_backfill: "No active tracks are waiting for popularity backfill.",
};

function isGenreFilter(value: string | null): value is GenreFilter {
  return !!value && value in genreFilterLabels;
}

function isPopularityFilter(value: string | null): value is PopularityFilter {
  return !!value && value in popularityFilterLabels;
}

function metadataFilterLabel(section: MetadataSection, filter: MetadataFilter) {
  return section === "genres" ? genreFilterLabels[filter as GenreFilter] : popularityFilterLabels[filter as PopularityFilter];
}

function metadataEmptyMessage(section: MetadataSection, filter: MetadataFilter) {
  return section === "genres" ? genreEmptyMessages[filter as GenreFilter] : popularityEmptyMessages[filter as PopularityFilter];
}

function formatDuration(value: number | null) {
  if (!value) return "â€”";
  const totalSeconds = Math.round(value / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function formatFeature(value: number | null) {
  return value === null ? "â€”" : value.toFixed(2);
}

export default function LibraryHealthPage() {
  const [libraries, setLibraries] = useState<HealthLibrary[]>([]);
  const [tracks, setTracks] = useState<MissingTrack[]>([]);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(initialFilters);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState("30");
  const [customThreshold, setCustomThreshold] = useState("30");
  const [confirmCleanup, setConfirmCleanup] = useState<{ count: number; payload: Record<string, unknown>; label: string } | null>(null);
  const [bpmFilter, setBpmFilter] = useState<BpmFilter | null>(null);
  const [bpmLibraryId, setBpmLibraryId] = useState("");
  const [bpmSearch, setBpmSearch] = useState("");
  const [bpmAppliedSearch, setBpmAppliedSearch] = useState("");
  const [bpmTracks, setBpmTracks] = useState<BpmTrack[]>([]);
  const [bpmPage, setBpmPage] = useState(1);
  const [bpmPagination, setBpmPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [bpmSelected, setBpmSelected] = useState<Set<string>>(new Set());
  const [bpmLoading, setBpmLoading] = useState(false);
  const [audioFilter, setAudioFilter] = useState<AudioFilter | null>(null);
  const [audioLibraryId, setAudioLibraryId] = useState("");
  const [audioSearch, setAudioSearch] = useState("");
  const [audioAppliedSearch, setAudioAppliedSearch] = useState("");
  const [audioTracks, setAudioTracks] = useState<AudioFeatureTrack[]>([]);
  const [audioPage, setAudioPage] = useState(1);
  const [audioPagination, setAudioPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [audioSelected, setAudioSelected] = useState<Set<string>>(new Set());
  const [audioLoading, setAudioLoading] = useState(false);
  const [metadataSection, setMetadataSection] = useState<MetadataSection | null>(null);
  const [metadataFilter, setMetadataFilter] = useState<MetadataFilter | null>(null);
  const [metadataLibraryId, setMetadataLibraryId] = useState("");
  const [metadataSearch, setMetadataSearch] = useState("");
  const [metadataAppliedSearch, setMetadataAppliedSearch] = useState("");
  const [metadataTracks, setMetadataTracks] = useState<MetadataTrack[]>([]);
  const [metadataPage, setMetadataPage] = useState(1);
  const [metadataPagination, setMetadataPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [metadataSelected, setMetadataSelected] = useState<Set<string>>(new Set());
  const [metadataLoading, setMetadataLoading] = useState(false);

  const queryString = useCallback((source: Filters, requestedPage = page) => {
    const params = new URLSearchParams({ page: String(requestedPage), pageSize: "25" });
    Object.entries(source).forEach(([key, value]) => value && params.set(key, value));
    return params.toString();
  }, [page]);

  const loadSummary = useCallback(async () => {
    const response = await fetch("/api/settings/library-health", { cache: "no-store" });
    if (!response.ok) throw new Error((await response.json()).error || "Could not load health summary");
    setLibraries((await response.json()).libraries || []);
  }, []);

  const loadMissing = useCallback(async (source = appliedFilters, requestedPage = page) => {
    const response = await fetch(`/api/settings/library-health/missing?${queryString(source, requestedPage)}`, { cache: "no-store" });
    if (!response.ok) throw new Error((await response.json()).error || "Could not load missing tracks");
    const data = await response.json();
    setTracks(data.tracks || []);
    setPagination(data.pagination);
    setSelected(new Set());
  }, [appliedFilters, page, queryString]);

  const updateBpmUrl = useCallback((filter: BpmFilter | null, libraryId = "", search = "", requestedPage = 1) => {
    const url = new URL(window.location.href);
    if (filter) url.searchParams.set("section", "bpm"); else url.searchParams.delete("section");
    if (filter) url.searchParams.set("filter", filter); else url.searchParams.delete("filter");
    if (libraryId) url.searchParams.set("libraryId", libraryId); else url.searchParams.delete("libraryId");
    if (search) url.searchParams.set("search", search); else url.searchParams.delete("search");
    if (filter && requestedPage > 1) url.searchParams.set("page", String(requestedPage)); else url.searchParams.delete("page");
    window.history.replaceState({}, "", url);
  }, []);

  const updateMetadataUrl = useCallback((section: MetadataSection | null, filter: MetadataFilter | null, libraryId = "", search = "", requestedPage = 1) => {
    const url = new URL(window.location.href);
    if (section && filter) {
      url.searchParams.set("section", section);
      url.searchParams.set("filter", filter);
    } else {
      url.searchParams.delete("section");
      url.searchParams.delete("filter");
    }
    if (libraryId) url.searchParams.set("libraryId", libraryId); else url.searchParams.delete("libraryId");
    if (search) url.searchParams.set("search", search); else url.searchParams.delete("search");
    if (section && filter && requestedPage > 1) url.searchParams.set("page", String(requestedPage)); else url.searchParams.delete("page");
    window.history.replaceState({}, "", url);
  }, []);

  const loadBpmTracks = useCallback(async (filter: BpmFilter, libraryId = "", search = "", requestedPage = 1) => {
    setBpmLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ filter, page: String(requestedPage), pageSize: "50" });
      if (libraryId) params.set("libraryId", libraryId);
      if (search) params.set("search", search);
      const response = await fetch(`/api/settings/library-health/bpm-tracks?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load BPM tracks");
      setBpmTracks(data.tracks || []);
      setBpmPagination({ page: data.page, pageSize: data.pageSize, total: data.total, totalPages: data.totalPages });
      setBpmSelected(new Set());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load BPM tracks");
    } finally {
      setBpmLoading(false);
    }
  }, []);

  const loadAudioTracks = useCallback(async (filter: AudioFilter, libraryId = "", search = "", requestedPage = 1) => {
    setAudioLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ filter, page: String(requestedPage), pageSize: "50" });
      if (libraryId) params.set("libraryId", libraryId);
      if (search) params.set("search", search);
      const response = await fetch(`/api/settings/library-health/audio-feature-tracks?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load audio-feature tracks");
      setAudioTracks(data.tracks || []);
      setAudioPagination({ page: data.page, pageSize: data.pageSize, total: data.total, totalPages: data.totalPages });
      setAudioSelected(new Set());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load audio-feature tracks");
    } finally {
      setAudioLoading(false);
    }
  }, []);

  const loadMetadataTracks = useCallback(async (section: MetadataSection, filter: MetadataFilter, libraryId = "", search = "", requestedPage = 1) => {
    setMetadataLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ section, filter, page: String(requestedPage), pageSize: "50" });
      if (libraryId) params.set("libraryId", libraryId);
      if (search) params.set("search", search);
      const response = await fetch(`/api/settings/library-health/metadata-tracks?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load metadata tracks");
      setMetadataTracks(data.tracks || []);
      setMetadataPagination({ page: data.page, pageSize: data.pageSize, total: data.total, totalPages: data.totalPages });
      setMetadataSelected(new Set());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load metadata tracks");
    } finally {
      setMetadataLoading(false);
    }
  }, []);

  const selectBpmFilter = useCallback((filter: BpmFilter, libraryId: string) => {
    setBpmFilter(filter);
    setAudioFilter(null);
    setMetadataSection(null);
    setMetadataFilter(null);
    setBpmLibraryId(libraryId);
    setBpmSearch("");
    setBpmAppliedSearch("");
    setBpmPage(1);
    updateBpmUrl(filter, libraryId);
    void loadBpmTracks(filter, libraryId);
    window.setTimeout(() => document.getElementById("bpm-track-list")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }, [loadBpmTracks, updateBpmUrl]);

  const selectAudioFilter = useCallback((filter: AudioFilter, libraryId: string) => {
    setAudioFilter(filter);
    setBpmFilter(null);
    setMetadataSection(null);
    setMetadataFilter(null);
    setAudioLibraryId(libraryId);
    setAudioSearch("");
    setAudioAppliedSearch("");
    setAudioPage(1);
    void loadAudioTracks(filter, libraryId);
    window.setTimeout(() => document.getElementById("audio-feature-track-list")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }, [loadAudioTracks]);

  const selectMetadataFilter = useCallback((section: MetadataSection, filter: MetadataFilter, libraryId: string) => {
    setMetadataSection(section);
    setMetadataFilter(filter);
    setMetadataLibraryId(libraryId);
    setMetadataSearch("");
    setMetadataAppliedSearch("");
    setMetadataPage(1);
    setBpmFilter(null);
    setAudioFilter(null);
    updateMetadataUrl(section, filter, libraryId);
    void loadMetadataTracks(section, filter, libraryId);
    window.setTimeout(() => document.getElementById("metadata-track-list")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }, [loadMetadataTracks, updateMetadataUrl]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      await Promise.all([loadSummary(), loadMissing()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Library health could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [loadMissing, loadSummary]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const restoreFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const section = params.get("section");
      const rawFilter = params.get("filter");
      const libraryId = params.get("libraryId") || "";
      const search = params.get("search") || "";
      const requestedPage = Math.max(1, Number(params.get("page")) || 1);

      if (section === "genres" && isGenreFilter(rawFilter)) {
        setMetadataSection("genres");
        setMetadataFilter(rawFilter);
        setMetadataLibraryId(libraryId);
        setMetadataSearch(search);
        setMetadataAppliedSearch(search);
        setMetadataPage(requestedPage);
        setBpmFilter(null);
        setAudioFilter(null);
        void loadMetadataTracks("genres", rawFilter, libraryId, search, requestedPage);
        return;
      }

      if (section === "popularity" && isPopularityFilter(rawFilter)) {
        setMetadataSection("popularity");
        setMetadataFilter(rawFilter);
        setMetadataLibraryId(libraryId);
        setMetadataSearch(search);
        setMetadataAppliedSearch(search);
        setMetadataPage(requestedPage);
        setBpmFilter(null);
        setAudioFilter(null);
        void loadMetadataTracks("popularity", rawFilter, libraryId, search, requestedPage);
        return;
      }

      const audioValue = rawFilter as AudioFilter | null;
      if (section === "audio" && audioValue && audioValue in audioFilterLabels) {
        setAudioFilter(audioValue);
        setAudioLibraryId(libraryId);
        setAudioSearch(search);
        setAudioAppliedSearch(search);
        setAudioPage(requestedPage);
        setMetadataSection(null);
        setMetadataFilter(null);
        setBpmFilter(null);
        void loadAudioTracks(audioValue, libraryId, search, requestedPage);
        return;
      }

      const value = rawFilter as BpmFilter | null;
      if ((!section || section === "bpm") && value && value in bpmFilterLabels) {
        setBpmFilter(value);
        setBpmLibraryId(libraryId);
        setBpmSearch(search);
        setBpmAppliedSearch(search);
        setBpmPage(requestedPage);
        setMetadataSection(null);
        setMetadataFilter(null);
        setAudioFilter(null);
        void loadBpmTracks(value, libraryId, search, requestedPage);
      }
    };
    restoreFromUrl();
    window.addEventListener("popstate", restoreFromUrl);
    return () => window.removeEventListener("popstate", restoreFromUrl);
  }, [loadAudioTracks, loadBpmTracks, loadMetadataTracks]);

  const runAction = async (key: string, url: string, body: Record<string, unknown>) => {
    setWorking(key);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Action failed");
      return data;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed");
      return null;
    } finally {
      setWorking(null);
    }
  };

  const resync = async (library: HealthLibrary) => {
    const data = await runAction(`resync:${library.id}`, "/api/settings/library-health/resync", { libraryId: library.id });
    if (data) { setMessage(data.status === "already_running" ? `${library.name} is already syncing.` : `Resync started for ${library.name}.`); await loadSummary(); }
  };

  const checkMissing = async (overrideTracks?: MissingTrack[]) => {
    const selectedTracks = overrideTracks || tracks.filter((track) => selected.has(track.id));
    const groups = new Map<string, string[]>();
    if (selectedTracks.length) {
      selectedTracks.forEach((track) => groups.set(track.library.id, [...(groups.get(track.library.id) || []), track.id]));
    } else if (appliedFilters.libraryId) {
      groups.set(appliedFilters.libraryId, []);
    } else {
      setError("Choose a library or select tracks before checking Plex.");
      return;
    }
    setWorking("check");
    let restored = 0;
    let checked = 0;
    try {
      for (const [libraryId, trackIds] of Array.from(groups.entries())) {
        const response = await fetch("/api/settings/library-health/check-missing", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ libraryId, ...(trackIds.length ? { trackIds } : {}) }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Plex check failed");
        restored += data.restored;
        checked += data.checked;
      }
      setMessage(`Checked ${checked} missing track${checked === 1 ? "" : "s"}; restored ${restored}.`);
      await Promise.all([loadSummary(), loadMissing()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Plex check failed");
    } finally { setWorking(null); }
  };

  const previewCleanup = async (payload: Record<string, unknown>, label: string) => {
    const data = await runAction("preview", "/api/settings/library-health/cleanup", { ...payload, dryRun: true });
    if (data) setConfirmCleanup({ count: data.count, payload, label });
  };

  const executeCleanup = async () => {
    if (!confirmCleanup) return;
    const data = await runAction("cleanup", "/api/settings/library-health/cleanup", { ...confirmCleanup.payload, confirm: true });
    if (data) {
      setMessage(`Permanently removed ${data.deleted} missing track record${data.deleted === 1 ? "" : "s"} from Mixarr.`);
      setConfirmCleanup(null);
      await Promise.all([loadSummary(), loadMissing()]);
    }
  };

  const retryBpm = async (payload: { trackIds?: string[]; filter?: BpmFilter; libraryId?: string; providerMode?: RetryProviderMode }) => {
    const providerMode = payload.providerMode || "configured";
    const data = await runAction("bpm-retry", "/api/settings/library-health/bpm-retry", { ...payload, force: providerMode === "force_local", providerMode });
    if (!data) return;
    if (data.queued > 0) {
      const startResponse = await fetch("/api/sync/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine: "bpm", providerMode }),
      });
      const startData = await startResponse.json().catch(() => ({}));
      const suffix = startResponse.ok
        ? startData.status === "already_running" ? " The BPM analyzer is already running." : " BPM analysis started."
        : " The tracks will be processed by the next BPM run.";
      setMessage(`Queued ${data.queued} track${data.queued === 1 ? "" : "s"} for BPM retry.${suffix}`);
    } else {
      setMessage("No eligible active tracks were queued. Tracks with a valid BPM require a forced retry.");
    }
    await loadSummary();
    if (bpmFilter) await loadBpmTracks(bpmFilter, bpmLibraryId, bpmAppliedSearch, bpmPage);
  };

  const retryAudioFeatures = async (payload: { trackIds?: string[]; filter?: AudioFilter; libraryId?: string; providerMode?: RetryProviderMode }) => {
    const providerMode = payload.providerMode || "configured";
    const data = await runAction("audio-feature-retry", "/api/settings/library-health/audio-feature-retry", { ...payload, force: providerMode === "force_local", providerMode });
    if (!data) return;
    if (data.queued > 0) {
      const startResponse = await fetch("/api/sync/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine: "audio", providerMode, libraryId: payload.libraryId, audioFeaturePartialBefore: data.before }),
      });
      const startData = await startResponse.json().catch(() => ({}));
      const suffix = startResponse.ok
        ? startData.status === "already_running" ? " The audio-feature analyzer is already running." : " Audio-feature analysis started."
        : " The tracks will be processed by the next audio-feature run.";
      setMessage(`Queued ${data.queued} track${data.queued === 1 ? "" : "s"} for audio-feature retry.${suffix}`);
    } else {
      setMessage("No eligible active tracks were queued.");
    }
    await loadSummary();
    if (audioFilter) await loadAudioTracks(audioFilter, audioLibraryId, audioAppliedSearch, audioPage);
  };

  const retryMetadata = async (payload: { trackIds?: string[]; filter?: MetadataFilter; libraryId?: string }) => {
    if (!metadataSection) return;
    const engine = metadataSection === "genres" ? "tags" : "popularity";
    const endpoint = metadataSection === "genres" ? "/api/settings/library-health/genre-retry" : "/api/settings/library-health/popularity-retry";
    const label = metadataSection === "genres" ? "genre" : "popularity";
    const data = await runAction(`${label}-retry`, endpoint, { ...payload, force: false });
    if (!data) return;
    if (data.queued > 0) {
      const startResponse = await fetch("/api/sync/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine }),
      });
      const startData = await startResponse.json().catch(() => ({}));
      const suffix = startResponse.ok
        ? startData.status === "already_running" ? ` The ${label} sync is already running.` : ` ${label[0].toUpperCase()}${label.slice(1)} sync started.`
        : ` The tracks will be processed by the next ${label} run.`;
      setMessage(`Queued ${data.queued} track${data.queued === 1 ? "" : "s"} for ${label} retry.${suffix}`);
    } else {
      setMessage(`No eligible active tracks were queued. Tracks with valid ${label} data require a forced retry.`);
    }
    await loadSummary();
    if (metadataSection && metadataFilter) await loadMetadataTracks(metadataSection, metadataFilter, metadataLibraryId, metadataAppliedSearch, metadataPage);
  };

  const exportHref = (format: "csv" | "json") => `/api/settings/library-health/export?format=${format}&${queryString(appliedFilters, 1).replace(/(^|&)page=[^&]*/g, "").replace(/(^|&)pageSize=[^&]*/g, "")}`;
  const metadataExportHref = (format: "csv" | "json") => {
    if (!metadataSection || !metadataFilter) return "#";
    const params = new URLSearchParams({ section: metadataSection, filter: metadataFilter, format });
    if (metadataLibraryId) params.set("libraryId", metadataLibraryId);
    if (metadataAppliedSearch) params.set("search", metadataAppliedSearch);
    return `/api/settings/library-health/export?${params}`;
  };
  const allVisibleSelected = tracks.length > 0 && tracks.every((track) => selected.has(track.id));
  const cleanupDays = threshold === "custom" ? Math.max(1, Number(customThreshold) || 30) : Number(threshold);
  const selectedCount = selected.size;
  const bpmSelectedCount = bpmSelected.size;
  const allVisibleBpmSelected = bpmTracks.length > 0 && bpmTracks.every((track) => bpmSelected.has(track.id));
  const audioSelectedCount = audioSelected.size;
  const allVisibleAudioSelected = audioTracks.length > 0 && audioTracks.every((track) => audioSelected.has(track.id));
  const metadataSelectedCount = metadataSelected.size;
  const allVisibleMetadataSelected = metadataTracks.length > 0 && metadataTracks.every((track) => metadataSelected.has(track.id));
  const totalActive = useMemo(() => libraries.reduce((sum, library) => sum + library.activeTracks, 0), [libraries]);
  const bpmMode = libraries[0]?.bpmProviderMode || "Disabled";
  const audioMode = libraries[0]?.audioFeatureProviderMode || "Disabled";
  const bpmApiEnabled = bpmMode.includes("API");
  const bpmLocalEnabled = bpmMode.includes("Local");
  const audioApiEnabled = audioMode.includes("API");
  const audioLocalEnabled = audioMode.includes("Local");

  if (loading) return <div className={styles.loading}><Loader2 className="animate-spin" /> Loading library healthâ€¦</div>;

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div>
          <Link href="/settings" className={styles.back}><ArrowLeft size={15} /> Settings</Link>
          <h2><HeartPulse size={28} /> Library Health &amp; Cleanup</h2>
          <p>Verify Plex reconciliation, inspect missing records, and clean up safely.</p>
        </div>
        <div className={styles.totalActive}><span>Active tracks</span><strong>{formatNumber(totalActive)}</strong></div>
      </header>

      {error && <div className={styles.errorBanner}><ShieldAlert size={18} /> {error}</div>}
      {message && <div className={styles.successBanner}><CheckCircle2 size={18} /> {message}</div>}

      <section className={styles.libraryGrid} aria-label="Library health summaries">
        {libraries.map((library) => (
          <article className={`glass-panel ${styles.libraryCard}`} key={library.id}>
            <div className={styles.cardHeader}>
              <div><span className={styles.serverName}>{library.server.name}</span><h3>{library.name}</h3></div>
              <span className={`${styles.status} ${styles[library.status]}`}>
                {library.status === "healthy" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{library.status}
              </span>
            </div>
            <h4 className={styles.healthGroupTitle}>Plex Sync Health</h4>
            <p className={styles.healthGroupCopy}>Normal health stats count active Plex tracks only. Missing and deleted records are excluded from metadata totals.</p>
            <div className={styles.primaryStats}>
              <div><span>Active tracks</span><strong>{formatNumber(library.activeTracks)}</strong></div>
              <div><span>Missing tracks</span><strong>{formatNumber(library.missingTracks)}</strong></div>
              <div><span>Missing albums</span><strong>{formatNumber(library.missingAlbums)}</strong></div>
              <div><span>Missing artists</span><strong>{formatNumber(library.missingArtists)}</strong></div>
            </div>
            <div className={styles.integrity}>
              <div><span>Plex reported</span><b>{formatNumber(library.plexReportedTrackCount)}</b></div>
              <div><span>Mixarr active</span><b>{formatNumber(library.mixarrActiveTrackCount)}</b></div>
              <div><span>Difference</span><b className={library.difference === 0 ? styles.good : styles.bad}>{library.difference === null ? "â€”" : library.difference > 0 ? `+${library.difference}` : library.difference}</b></div>
            </div>
            <h4 className={styles.healthGroupTitle}>BPM Health</h4>
            <p className={styles.healthGroupCopy}>Mode: {library.bpmProviderMode}</p>
            <div className={styles.bpmGrid}>
              {([
                ["tracks_with_bpm", library.tracksWithBpm],
                ["api_bpm", library.bpmApi],
                ["local_bpm", library.bpmLocal],
                ["imported_bpm", library.bpmImported],
                ["missing_bpm", library.missingBpm],
                ["bpm_no_data", library.bpmNoData],
                ["bpm_failed", library.bpmFailed],
                ["extraction_failed", library.bpmExtractionFailed],
                ["analyzer_failed", library.bpmAnalyzerFailed],
                ["too_short", library.bpmTooShort],
                ["pending_bpm", library.bpmPendingBackfill],
              ] as [BpmFilter, number][]).map(([filter, count]) => (
                <button
                  type="button"
                  key={filter}
                  className={`${styles.bpmCard} ${bpmFilter === filter && bpmLibraryId === library.id ? styles.bpmCardActive : ""}`}
                  onClick={() => selectBpmFilter(filter, library.id)}
                  aria-pressed={bpmFilter === filter && bpmLibraryId === library.id}
                >
                  <span>{bpmFilterLabels[filter]}</span><b>{formatNumber(count)}</b>
                  <small>View tracks <ArrowRight size={11} /></small>
                </button>
              ))}
            </div>
            <h4 className={styles.healthGroupTitle}>Audio Feature Health</h4>
            <p className={styles.healthGroupCopy}>Mode: {library.audioFeatureProviderMode}</p>
            <div className={styles.bpmGrid} aria-label="Audio feature health">
              {([
                ["api_audio_features", library.audioFeaturesApi],
                ["local_audio_features", library.audioFeaturesLocal],
                ["heuristic_audio_features", library.audioFeaturesHeuristic],
                ["partial_audio_features", library.audioFeaturesPartial],
                ["missing_audio_features", library.audioFeaturesMissing],
                ["audio_feature_no_data", library.audioFeaturesNoData],
                ["audio_feature_failed", library.audioFeaturesFailed],
                ["extraction_failed", library.audioFeaturesExtractionFailed],
                ["analyzer_failed", library.audioFeaturesAnalyzerFailed],
                ["too_short", library.audioFeaturesTooShort],
                ["pending_audio_features", library.audioFeaturesMissing],
              ] as [AudioFilter, number][]).map(([filter, count]) => (
                <button
                  type="button"
                  key={`audio:${filter}`}
                  className={`${styles.bpmCard} ${audioFilter === filter && audioLibraryId === library.id ? styles.bpmCardActive : ""}`}
                  onClick={() => selectAudioFilter(filter, library.id)}
                  aria-pressed={audioFilter === filter && audioLibraryId === library.id}
                >
                  <span>{audioFilterLabels[filter]}</span><b>{formatNumber(count)}</b>
                  <small>View tracks <ArrowRight size={11} /></small>
                </button>
              ))}
            </div>
            <h4 className={styles.healthGroupTitle}>Genre Health</h4>
            <div className={styles.bpmGrid} aria-label="Genre health">
              {([
                ["tracks_with_genres", library.tracksWithGenres],
                ["missing_genres", library.missingGenres],
                ["genre_no_data", library.genreNoData],
                ["genre_failed", library.genreFailed],
                ["pending_genre_backfill", library.pendingGenreBackfill],
              ] as [GenreFilter, number][]).map(([filter, count]) => (
                <button
                  type="button"
                  key={`genre:${filter}`}
                  className={`${styles.bpmCard} ${metadataSection === "genres" && metadataFilter === filter && metadataLibraryId === library.id ? styles.bpmCardActive : ""}`}
                  onClick={() => selectMetadataFilter("genres", filter, library.id)}
                  aria-pressed={metadataSection === "genres" && metadataFilter === filter && metadataLibraryId === library.id}
                >
                  <span>{genreFilterLabels[filter]}</span><b>{formatNumber(count)}</b>
                  <small>View tracks <ArrowRight size={11} /></small>
                </button>
              ))}
            </div>
            <h4 className={styles.healthGroupTitle}>Popularity Health</h4>
            <div className={styles.bpmGrid} aria-label="Popularity health">
              {([
                ["tracks_with_popularity", library.tracksWithPopularity],
                ["missing_popularity", library.missingPopularity],
                ["popularity_no_data", library.popularityNoData],
                ["popularity_failed", library.popularityFailed],
                ["pending_popularity_backfill", library.pendingPopularityBackfill],
              ] as [PopularityFilter, number][]).map(([filter, count]) => (
                <button
                  type="button"
                  key={`popularity:${filter}`}
                  className={`${styles.bpmCard} ${metadataSection === "popularity" && metadataFilter === filter && metadataLibraryId === library.id ? styles.bpmCardActive : ""}`}
                  onClick={() => selectMetadataFilter("popularity", filter, library.id)}
                  aria-pressed={metadataSection === "popularity" && metadataFilter === filter && metadataLibraryId === library.id}
                >
                  <span>{popularityFilterLabels[filter]}</span><b>{formatNumber(count)}</b>
                  <small>View tracks <ArrowRight size={11} /></small>
                </button>
              ))}
            </div>
            <dl className={styles.syncDetails}>
              <div><dt>Last full sync</dt><dd>{formatDate(library.lastFullSyncAt)}</dd></div>
              <div><dt>Last reconciliation</dt><dd>{formatDate(library.lastReconciliationAt)}</dd></div>
              <div><dt>Sync status</dt><dd>{library.lastSyncStatus}</dd></div>
              <div><dt>Run ID</dt><dd title={library.lastSyncRunId || ""}>{library.lastSyncRunId || "â€”"}</dd></div>
            </dl>
            {library.lastSyncError && <p className={styles.syncError}>{library.lastSyncError}</p>}
            <button className={styles.primaryButton} onClick={() => void resync(library)} disabled={working !== null}>
              {working === `resync:${library.id}` ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} Resync library
            </button>
          </article>
        ))}
        {!libraries.length && <div className={styles.empty}>No Plex music libraries are connected.</div>}
      </section>

      {metadataSection && metadataFilter && <section id="metadata-track-list" className={`glass-panel ${styles.bpmSection}`}>
        <div className={styles.sectionHeader}>
          <div>
            <h3><Music size={18} /> {metadataFilterLabel(metadataSection, metadataFilter)}</h3>
            <p>Active Plex tracks only. Search checks title, artist, album, media path, and Plex rating key.</p>
          </div>
          <div className={styles.exportActions}>
            <a href={metadataExportHref("csv")} className={styles.secondaryButton}><Download size={15} /> CSV</a>
            <a href={metadataExportHref("json")} className={styles.secondaryButton}><FileJson size={15} /> JSON</a>
            <button className={styles.secondaryButton} type="button" onClick={() => { setMetadataSection(null); setMetadataFilter(null); updateMetadataUrl(null, null); }}>Close</button>
          </div>
        </div>

        <form className={styles.bpmFilters} onSubmit={(event) => {
          event.preventDefault();
          setMetadataAppliedSearch(metadataSearch);
          setMetadataPage(1);
          updateMetadataUrl(metadataSection, metadataFilter, metadataLibraryId, metadataSearch, 1);
          void loadMetadataTracks(metadataSection, metadataFilter, metadataLibraryId, metadataSearch, 1);
        }}>
          <label><span>Library</span><select value={metadataLibraryId} onChange={(event) => {
            const libraryId = event.target.value;
            setMetadataLibraryId(libraryId);
            setMetadataPage(1);
            updateMetadataUrl(metadataSection, metadataFilter, libraryId, metadataAppliedSearch, 1);
            void loadMetadataTracks(metadataSection, metadataFilter, libraryId, metadataAppliedSearch, 1);
          }}><option value="">All libraries</option>{libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}</select></label>
          <label className={styles.bpmSearchField}><span>Search title, artist, album, path, or rating key</span><div><Search size={15} /><input value={metadataSearch} onChange={(event) => setMetadataSearch(event.target.value)} placeholder={`Search ${metadataSection} tracks`} /></div></label>
          <button className={styles.primaryButton} type="submit">Search</button>
          <button className={styles.secondaryButton} type="button" onClick={() => {
            setMetadataSearch(""); setMetadataAppliedSearch(""); setMetadataPage(1);
            updateMetadataUrl(metadataSection, metadataFilter, metadataLibraryId, "", 1);
            void loadMetadataTracks(metadataSection, metadataFilter, metadataLibraryId, "", 1);
          }}>Clear</button>
        </form>

        <div className={styles.actionBar}>
          <button className={styles.secondaryButton} disabled={!metadataSelectedCount || working !== null} onClick={() => void retryMetadata({ trackIds: Array.from(metadataSelected), libraryId: metadataLibraryId || undefined })}><RefreshCw size={15} /> Retry selected ({metadataSelectedCount})</button>
          <button className={styles.primaryButton} disabled={working !== null || metadataPagination.total === 0} onClick={() => void retryMetadata({ filter: metadataFilter, libraryId: metadataLibraryId || undefined })}>
            {working === "genre-retry" || working === "popularity-retry" ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />} Retry all in filter
          </button>
        </div>

        {metadataLoading ? <div className={styles.loading}><Loader2 className="animate-spin" size={18} /> Loading {metadataFilterLabel(metadataSection, metadataFilter).toLowerCase()}...</div> : <>
          <div className={`${styles.tableWrap} ${styles.bpmTableWrap}`}>
            <table>
              {metadataSection === "genres" ? (
                <>
                  <thead><tr><th><input type="checkbox" aria-label="Select visible genre tracks" checked={allVisibleMetadataSelected} onChange={() => setMetadataSelected(allVisibleMetadataSelected ? new Set() : new Set(metadataTracks.map((track) => track.id)))} /></th><th>Track</th><th>Artist</th><th>Album</th><th>Genres</th><th>Genre status</th><th>Failure reason</th><th>Last attempted</th><th>Media path</th><th>Actions</th></tr></thead>
                  <tbody>{metadataTracks.map((track) => <tr key={track.id}>
                    <td><input type="checkbox" aria-label={`Select ${track.title}`} checked={metadataSelected.has(track.id)} onChange={() => setMetadataSelected((current) => { const next = new Set(current); next.has(track.id) ? next.delete(track.id) : next.add(track.id); return next; })} /></td>
                    <td data-label="Track"><strong>{track.title}</strong><small className={styles.trackMeta}>{track.library.name} | {formatDuration(track.duration)} | {track.ratingKey}</small></td>
                    <td data-label="Artist">{track.artist}</td>
                    <td data-label="Album">{track.album}</td>
                    <td data-label="Genres">{track.genres.length ? track.genres.join(", ") : "â€”"}</td>
                    <td data-label="Genre status"><span className={styles.bpmBadge}>{track.genreStatus}</span></td>
                    <td data-label="Failure reason" className={styles.failureReason} title={track.genreFailureReason || ""}>{track.genreFailureReason || "â€”"}</td>
                    <td data-label="Last attempted">{formatDate(track.genreAttemptedAt)}</td>
                    <td data-label="Media path" className={styles.path} title={track.mediaPath || ""}>{track.mediaPath || "â€”"}</td>
                    <td data-label="Actions">{track.genreStatus !== "success" ? <button className={styles.tableAction} disabled={working !== null} onClick={() => void retryMetadata({ trackIds: [track.id], libraryId: track.library.id })}>Retry this track</button> : "â€”"}</td>
                  </tr>)}</tbody>
                </>
              ) : (
                <>
                  <thead><tr><th><input type="checkbox" aria-label="Select visible popularity tracks" checked={allVisibleMetadataSelected} onChange={() => setMetadataSelected(allVisibleMetadataSelected ? new Set() : new Set(metadataTracks.map((track) => track.id)))} /></th><th>Track</th><th>Artist</th><th>Album</th><th>Popularity</th><th>Popularity source</th><th>Popularity status</th><th>Failure reason</th><th>Last attempted</th><th>Media path</th><th>Actions</th></tr></thead>
                  <tbody>{metadataTracks.map((track) => <tr key={track.id}>
                    <td><input type="checkbox" aria-label={`Select ${track.title}`} checked={metadataSelected.has(track.id)} onChange={() => setMetadataSelected((current) => { const next = new Set(current); next.has(track.id) ? next.delete(track.id) : next.add(track.id); return next; })} /></td>
                    <td data-label="Track"><strong>{track.title}</strong><small className={styles.trackMeta}>{track.library.name} | {formatDuration(track.duration)} | {track.ratingKey}</small></td>
                    <td data-label="Artist">{track.artist}</td>
                    <td data-label="Album">{track.album}</td>
                    <td data-label="Popularity">{track.popularityScore === null ? "â€”" : Math.round(track.popularityScore * 10) / 10}</td>
                    <td data-label="Popularity source">{track.popularitySource || "â€”"}</td>
                    <td data-label="Popularity status"><span className={styles.bpmBadge}>{track.popularityStatus}</span></td>
                    <td data-label="Failure reason" className={styles.failureReason} title={track.popularityFailureReason || ""}>{track.popularityFailureReason || "â€”"}</td>
                    <td data-label="Last attempted">{formatDate(track.popularityAttemptedAt)}</td>
                    <td data-label="Media path" className={styles.path} title={track.mediaPath || ""}>{track.mediaPath || "â€”"}</td>
                    <td data-label="Actions">{track.popularityStatus !== "success" ? <button className={styles.tableAction} disabled={working !== null} onClick={() => void retryMetadata({ trackIds: [track.id], libraryId: track.library.id })}>Retry this track</button> : "â€”"}</td>
                  </tr>)}</tbody>
                </>
              )}
            </table>
            {!metadataTracks.length && <div className={styles.empty}>{metadataEmptyMessage(metadataSection, metadataFilter)}{metadataAppliedSearch ? " Try clearing the search." : ""}</div>}
          </div>
          <div className={styles.pagination}><span>{formatNumber(metadataPagination.total)} track{metadataPagination.total === 1 ? "" : "s"}</span><div><button aria-label="Previous metadata page" disabled={metadataPage <= 1} onClick={() => { const next = metadataPage - 1; setMetadataPage(next); updateMetadataUrl(metadataSection, metadataFilter, metadataLibraryId, metadataAppliedSearch, next); void loadMetadataTracks(metadataSection, metadataFilter, metadataLibraryId, metadataAppliedSearch, next); }}><ChevronLeft size={16} /></button><span>Page {metadataPagination.page} of {metadataPagination.totalPages}</span><button aria-label="Next metadata page" disabled={metadataPage >= metadataPagination.totalPages} onClick={() => { const next = metadataPage + 1; setMetadataPage(next); updateMetadataUrl(metadataSection, metadataFilter, metadataLibraryId, metadataAppliedSearch, next); void loadMetadataTracks(metadataSection, metadataFilter, metadataLibraryId, metadataAppliedSearch, next); }}><ChevronRight size={16} /></button></div></div>
        </>}
      </section>}

      {audioFilter && <section id="audio-feature-track-list" className={`glass-panel ${styles.bpmSection}`}>
        <div className={styles.sectionHeader}>
          <div>
            <h3><Music size={18} /> {audioFilterLabels[audioFilter]}</h3>
            <p>Active Plex tracks only. API fields are preserved; local Essentia and heuristic fields are marked by source.</p>
          </div>
          <button className={styles.secondaryButton} type="button" onClick={() => { setAudioFilter(null); }}>Close</button>
        </div>

        <form className={styles.bpmFilters} onSubmit={(event) => {
          event.preventDefault();
          setAudioAppliedSearch(audioSearch);
          setAudioPage(1);
          void loadAudioTracks(audioFilter, audioLibraryId, audioSearch, 1);
        }}>
          <label><span>Library</span><select value={audioLibraryId} onChange={(event) => {
            const libraryId = event.target.value;
            setAudioLibraryId(libraryId);
            setAudioPage(1);
            void loadAudioTracks(audioFilter, libraryId, audioAppliedSearch, 1);
          }}><option value="">All libraries</option>{libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}</select></label>
          <label className={styles.bpmSearchField}><span>Search title, artist, album, or path</span><div><Search size={15} /><input value={audioSearch} onChange={(event) => setAudioSearch(event.target.value)} placeholder="Search audio-feature tracks" /></div></label>
          <button className={styles.primaryButton} type="submit">Search</button>
          <button className={styles.secondaryButton} type="button" onClick={() => {
            setAudioSearch(""); setAudioAppliedSearch(""); setAudioPage(1);
            void loadAudioTracks(audioFilter, audioLibraryId, "", 1);
          }}>Clear</button>
        </form>

        <div className={styles.actionBar}>
          <button className={styles.secondaryButton} disabled={!audioSelectedCount || working !== null} onClick={() => void retryAudioFeatures({ trackIds: Array.from(audioSelected), libraryId: audioLibraryId || undefined })}><RefreshCw size={15} /> Retry selected ({audioSelectedCount})</button>
          <button className={styles.primaryButton} disabled={working !== null || audioPagination.total === 0} onClick={() => void retryAudioFeatures({ filter: audioFilter, libraryId: audioLibraryId || undefined })}>
            {working === "audio-feature-retry" ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />} Retry using configured providers
          </button>
          {audioApiEnabled && <button className={styles.secondaryButton} disabled={working !== null || audioPagination.total === 0} onClick={() => void retryAudioFeatures({ filter: audioFilter, libraryId: audioLibraryId || undefined, providerMode: "api_only" })}>Retry using API only</button>}
          {audioLocalEnabled && <button className={styles.secondaryButton} disabled={working !== null || audioPagination.total === 0} onClick={() => void retryAudioFeatures({ filter: audioFilter, libraryId: audioLibraryId || undefined, providerMode: "local_only" })}>Retry using local Essentia only</button>}
          {audioLocalEnabled && <button className={styles.secondaryButton} disabled={working !== null || audioPagination.total === 0} onClick={() => void retryAudioFeatures({ filter: audioFilter, libraryId: audioLibraryId || undefined, providerMode: "force_local" })}>Force local reprocess</button>}
        </div>

        {audioLoading ? <div className={styles.loading}><Loader2 className="animate-spin" size={18} /> Loading {audioFilterLabels[audioFilter].toLowerCase()}...</div> : <>
          <div className={`${styles.tableWrap} ${styles.bpmTableWrap}`}>
            <table>
              <thead><tr><th><input type="checkbox" aria-label="Select visible audio-feature tracks" checked={allVisibleAudioSelected} onChange={() => setAudioSelected(allVisibleAudioSelected ? new Set() : new Set(audioTracks.map((track) => track.id)))} /></th><th>Track</th><th>Artist</th><th>Album</th><th>Effective</th><th>API values</th><th>Local values</th><th>BPM</th><th>Source</th><th>Scope</th><th>Confidence</th><th>Status</th><th>Failure reason</th><th>Analyzed</th><th>Media path</th><th>Actions</th></tr></thead>
              <tbody>{audioTracks.map((track) => <tr key={track.id}>
                <td><input type="checkbox" aria-label={`Select ${track.title}`} checked={audioSelected.has(track.id)} onChange={() => setAudioSelected((current) => { const next = new Set(current); next.has(track.id) ? next.delete(track.id) : next.add(track.id); return next; })} /></td>
                <td data-label="Track"><strong>{track.title}</strong><small className={styles.trackMeta}>{track.library.name} | {formatDuration(track.duration)} | {track.ratingKey}</small></td>
                <td data-label="Artist">{track.artist}</td>
                <td data-label="Album">{track.album}</td>
                <td data-label="Effective">E {formatFeature(track.energy)}<small className={styles.trackMeta}>Mood {formatFeature(track.mood)} | Dance {formatFeature(track.danceability)} | Acoustic {formatFeature(track.acousticness)}</small></td>
                <td data-label="API values">E {formatFeature(track.api.energy)}<small className={styles.trackMeta}>Mood {formatFeature(track.api.mood)} | Dance {formatFeature(track.api.danceability)} | Acoustic {formatFeature(track.api.acousticness)}</small></td>
                <td data-label="Local values">E {formatFeature(track.local.energy)}<small className={styles.trackMeta}>Mood {formatFeature(track.local.mood)} | Dance {formatFeature(track.local.danceability)} | Acoustic {formatFeature(track.local.acousticness)}</small></td>
                <td data-label="BPM">{track.bpm === null ? "â€”" : Math.round(track.bpm * 10) / 10}</td>
                <td data-label="Source">{track.source || "â€”"}</td>
                <td data-label="Scope">{track.analysisScope || "â€”"}</td>
                <td data-label="Confidence">{track.confidence === null ? "â€”" : `${Math.round(track.confidence * 100)}%`}</td>
                <td data-label="Status"><span className={styles.bpmBadge}>{track.status}</span></td>
                <td data-label="Failure reason" className={styles.failureReason} title={track.failureReason || ""}>{track.failureReason || "â€”"}</td>
                <td data-label="Analyzed">{formatDate(track.analyzedAt)}</td>
                <td data-label="Media path" className={styles.path} title={track.mediaPath || ""}>{track.mediaPath || "â€”"}</td>
                <td data-label="Actions">{track.status !== "success" ? <button className={styles.tableAction} disabled={working !== null} onClick={() => void retryAudioFeatures({ trackIds: [track.id], libraryId: track.library.id })}>Retry audio</button> : "â€”"}</td>
              </tr>)}</tbody>
            </table>
            {!audioTracks.length && <div className={styles.empty}>{audioEmptyMessages[audioFilter]}{audioAppliedSearch ? " Try clearing the search." : ""}</div>}
          </div>
          <div className={styles.pagination}><span>{formatNumber(audioPagination.total)} track{audioPagination.total === 1 ? "" : "s"}</span><div><button aria-label="Previous audio-feature page" disabled={audioPage <= 1} onClick={() => { const next = audioPage - 1; setAudioPage(next); void loadAudioTracks(audioFilter, audioLibraryId, audioAppliedSearch, next); }}><ChevronLeft size={16} /></button><span>Page {audioPagination.page} of {audioPagination.totalPages}</span><button aria-label="Next audio-feature page" disabled={audioPage >= audioPagination.totalPages} onClick={() => { const next = audioPage + 1; setAudioPage(next); void loadAudioTracks(audioFilter, audioLibraryId, audioAppliedSearch, next); }}><ChevronRight size={16} /></button></div></div>
        </>}
      </section>}

      {bpmFilter && <section id="bpm-track-list" className={`glass-panel ${styles.bpmSection}`}>
        <div className={styles.sectionHeader}>
          <div>
            <h3>{bpmFilterLabels[bpmFilter]}</h3>
            <p>Active Plex tracks only. Missing and deleted library records are excluded.</p>
          </div>
          <button className={styles.secondaryButton} type="button" onClick={() => { setBpmFilter(null); updateBpmUrl(null); }}>Close</button>
        </div>

        <form className={styles.bpmFilters} onSubmit={(event) => {
          event.preventDefault();
          setBpmAppliedSearch(bpmSearch);
          setBpmPage(1);
          updateBpmUrl(bpmFilter, bpmLibraryId, bpmSearch, 1);
          void loadBpmTracks(bpmFilter, bpmLibraryId, bpmSearch, 1);
        }}>
          <label><span>Library</span><select value={bpmLibraryId} onChange={(event) => {
            const libraryId = event.target.value;
            setBpmLibraryId(libraryId);
            setBpmPage(1);
            updateBpmUrl(bpmFilter, libraryId, bpmAppliedSearch, 1);
            void loadBpmTracks(bpmFilter, libraryId, bpmAppliedSearch, 1);
          }}><option value="">All libraries</option>{libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}</select></label>
          <label className={styles.bpmSearchField}><span>Search title, artist, album, or path</span><div><Search size={15} /><input value={bpmSearch} onChange={(event) => setBpmSearch(event.target.value)} placeholder="Search BPM tracks" /></div></label>
          <button className={styles.primaryButton} type="submit">Search</button>
          <button className={styles.secondaryButton} type="button" onClick={() => {
            setBpmSearch(""); setBpmAppliedSearch(""); setBpmPage(1);
            updateBpmUrl(bpmFilter, bpmLibraryId, "", 1);
            void loadBpmTracks(bpmFilter, bpmLibraryId, "", 1);
          }}>Clear</button>
        </form>

        <div className={styles.actionBar}>
          <button className={styles.secondaryButton} disabled={!bpmSelectedCount || working !== null} onClick={() => void retryBpm({ trackIds: Array.from(bpmSelected), libraryId: bpmLibraryId || undefined })}><RefreshCw size={15} /> Retry selected ({bpmSelectedCount})</button>
          <button className={styles.primaryButton} disabled={working !== null || bpmPagination.total === 0} onClick={() => void retryBpm({ filter: bpmFilter, libraryId: bpmLibraryId || undefined })}>
            {working === "bpm-retry" ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />} Retry using configured providers
          </button>
          {bpmApiEnabled && <button className={styles.secondaryButton} disabled={working !== null || bpmPagination.total === 0} onClick={() => void retryBpm({ filter: bpmFilter, libraryId: bpmLibraryId || undefined, providerMode: "api_only" })}>Retry using API only</button>}
          {bpmLocalEnabled && <button className={styles.secondaryButton} disabled={working !== null || bpmPagination.total === 0} onClick={() => void retryBpm({ filter: bpmFilter, libraryId: bpmLibraryId || undefined, providerMode: "local_only" })}>Retry using local Essentia only</button>}
          {bpmLocalEnabled && <button className={styles.secondaryButton} disabled={working !== null || bpmPagination.total === 0} onClick={() => void retryBpm({ filter: bpmFilter, libraryId: bpmLibraryId || undefined, providerMode: "force_local" })}>Force local reprocess</button>}
        </div>

        {bpmLoading ? <div className={styles.loading}><Loader2 className="animate-spin" size={18} /> Loading {bpmFilterLabels[bpmFilter].toLowerCase()}â€¦</div> : <>
          <div className={`${styles.tableWrap} ${styles.bpmTableWrap}`}>
            <table>
              <thead><tr><th><input type="checkbox" aria-label="Select visible BPM tracks" checked={allVisibleBpmSelected} onChange={() => setBpmSelected(allVisibleBpmSelected ? new Set() : new Set(bpmTracks.map((track) => track.id)))} /></th><th>Track</th><th>Artist</th><th>Album</th><th>Effective BPM</th><th>API BPM</th><th>Local BPM</th><th>Source</th><th>Scope</th><th>Status</th><th>Failure reason</th><th>Last analyzed</th><th>Media path</th><th>Actions</th></tr></thead>
              <tbody>{bpmTracks.map((track) => <tr key={track.id}>
                <td><input type="checkbox" aria-label={`Select ${track.title}`} checked={bpmSelected.has(track.id)} onChange={() => setBpmSelected((current) => { const next = new Set(current); next.has(track.id) ? next.delete(track.id) : next.add(track.id); return next; })} /></td>
                <td data-label="Track"><strong>{track.title}</strong><small className={styles.trackMeta}>{track.library.name} | {formatDuration(track.duration)} | {track.ratingKey}</small></td>
                <td data-label="Artist">{track.artist}</td>
                <td data-label="Album">{track.album}</td>
                <td data-label="BPM">{track.effectiveBpm === null ? "â€”" : Math.round(track.effectiveBpm * 10) / 10}</td>
                <td data-label="API BPM">{track.apiBpm === null ? "â€”" : Math.round(track.apiBpm * 10) / 10}</td>
                <td data-label="Local BPM">{track.localBpm === null ? "â€”" : Math.round(track.localBpm * 10) / 10}</td>
                <td data-label="BPM source">{track.bpmSource || "â€”"}{track.bpmConfidence !== null && <small className={styles.trackMeta}>{Math.round(track.bpmConfidence * 100)}% confidence</small>}</td>
                <td data-label="Scope">{track.bpmAnalysisScope || "â€”"}</td>
                <td data-label="BPM status"><span className={styles.bpmBadge}>{labelBpm(track.bpmAnalysisStatus)}</span></td>
                <td data-label="Failure reason" className={styles.failureReason} title={track.bpmFailureReason || ""}>{track.bpmFailureReason || "â€”"}</td>
                <td data-label="Last analyzed">{formatDate(track.bpmAnalyzedAt)}</td>
                <td data-label="Media path" className={styles.path} title={track.mediaPath || ""}>{track.mediaPath || "â€”"}</td>
                <td data-label="Actions">{track.effectiveBpm === null ? <button className={styles.tableAction} disabled={working !== null} onClick={() => void retryBpm({ trackIds: [track.id], libraryId: track.library.id })}>Retry BPM</button> : "â€”"}</td>
              </tr>)}</tbody>
            </table>
            {!bpmTracks.length && <div className={styles.empty}>{bpmEmptyMessages[bpmFilter]}{bpmAppliedSearch ? " Try clearing the search." : ""}</div>}
          </div>
          <div className={styles.pagination}><span>{formatNumber(bpmPagination.total)} track{bpmPagination.total === 1 ? "" : "s"}</span><div><button aria-label="Previous BPM page" disabled={bpmPage <= 1} onClick={() => { const next = bpmPage - 1; setBpmPage(next); updateBpmUrl(bpmFilter, bpmLibraryId, bpmAppliedSearch, next); void loadBpmTracks(bpmFilter, bpmLibraryId, bpmAppliedSearch, next); }}><ChevronLeft size={16} /></button><span>Page {bpmPagination.page} of {bpmPagination.totalPages}</span><button aria-label="Next BPM page" disabled={bpmPage >= bpmPagination.totalPages} onClick={() => { const next = bpmPage + 1; setBpmPage(next); updateBpmUrl(bpmFilter, bpmLibraryId, bpmAppliedSearch, next); void loadBpmTracks(bpmFilter, bpmLibraryId, bpmAppliedSearch, next); }}><ChevronRight size={16} /></button></div></div>
        </>}
      </section>}

      <section className={`glass-panel ${styles.missingSection}`}>
        <div className={styles.sectionHeader}>
          <div><h3>Missing tracks</h3><p>Soft-deleted records stay here until Plex restores them or you explicitly clean them up.</p></div>
          <div className={styles.exportActions}>
            <a href={exportHref("csv")} className={styles.secondaryButton}><Download size={15} /> CSV</a>
            <a href={exportHref("json")} className={styles.secondaryButton}><FileJson size={15} /> JSON</a>
          </div>
        </div>

        <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); setPage(1); setAppliedFilters(filters); void loadMissing(filters, 1); }}>
          <label><span>Library</span><select value={filters.libraryId} onChange={(e) => setFilters({ ...filters, libraryId: e.target.value })}><option value="">All libraries</option>{libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}</select></label>
          <label className={styles.searchField}><span>Title, path, or rating key</span><div><Search size={15} /><input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Search missing tracks" /></div></label>
          <label><span>Artist</span><input value={filters.artist} onChange={(e) => setFilters({ ...filters, artist: e.target.value })} /></label>
          <label><span>Album</span><input value={filters.album} onChange={(e) => setFilters({ ...filters, album: e.target.value })} /></label>
          <label><span>Missing since</span><input type="date" value={filters.missingSinceFrom} onChange={(e) => setFilters({ ...filters, missingSinceFrom: e.target.value })} /></label>
          <label><span>BPM status</span><select value={filters.bpmStatus} onChange={(e) => setFilters({ ...filters, bpmStatus: e.target.value })}><option value="">All statuses</option><option value="with_bpm">BPM available</option><option value="pending">Pending</option><option value="no_data">No data</option><option value="failed">Legacy failure</option><option value="extraction_failed">Extraction failed</option><option value="analyzer_failed">Analyzer failed</option><option value="too_short">Too short</option></select></label>
          <button className={styles.primaryButton} type="submit">Apply filters</button>
          <button className={styles.secondaryButton} type="button" onClick={() => { setFilters(initialFilters); setAppliedFilters(initialFilters); setPage(1); void loadMissing(initialFilters, 1); }}>Reset</button>
        </form>

        <div className={styles.actionBar}>
          <button className={styles.secondaryButton} onClick={() => void checkMissing()} disabled={working !== null}><RefreshCw size={15} /> {selectedCount ? `Check selected (${selectedCount})` : "Check missing in library"}</button>
          <button className={styles.dangerButton} onClick={() => void previewCleanup({ trackIds: Array.from(selected) }, "selected missing tracks")} disabled={!selectedCount || working !== null}><Trash2 size={15} /> Delete selected</button>
          <div className={styles.thresholdControl}>
            <span>Delete missing older than</span>
            <select value={threshold} onChange={(e) => setThreshold(e.target.value)}>{[7, 14, 30, 60, 90].map((days) => <option key={days} value={days}>{days} days</option>)}<option value="custom">Custom</option></select>
            {threshold === "custom" && <input aria-label="Custom cleanup days" type="number" min="1" value={customThreshold} onChange={(e) => setCustomThreshold(e.target.value)} />}
            <button className={styles.dangerButton} onClick={() => void previewCleanup({ days: cleanupDays, ...(appliedFilters.libraryId ? { libraryId: appliedFilters.libraryId } : {}) }, `tracks missing for at least ${cleanupDays} days`)} disabled={working !== null}>Review cleanup</button>
          </div>
        </div>

        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th><input type="checkbox" aria-label="Select visible tracks" checked={allVisibleSelected} onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(tracks.map((track) => track.id)))} /></th><th>Track</th><th>Artist</th><th>Album</th><th>Library</th><th>Rating key</th><th>Media path</th><th>Last seen</th><th>Missing since</th><th>Sync run</th><th>BPM</th><th>Actions</th></tr></thead>
            <tbody>{tracks.map((track) => <tr key={track.id}>
              <td><input type="checkbox" aria-label={`Select ${track.title}`} checked={selected.has(track.id)} onChange={() => setSelected((current) => { const next = new Set(current); next.has(track.id) ? next.delete(track.id) : next.add(track.id); return next; })} /></td>
              <td data-label="Track"><strong>{track.title}</strong></td><td data-label="Artist">{track.artist.title}</td><td data-label="Album">{track.album.title}</td><td data-label="Library">{track.library.name}</td><td data-label="Rating key"><code>{track.ratingKey}</code></td><td data-label="Media path" className={styles.path} title={track.mediaPath || ""}>{track.mediaPath || "â€”"}</td><td data-label="Last seen">{formatDate(track.lastSeenAt)}</td><td data-label="Missing since">{formatDate(track.missingSince)}</td><td data-label="Sync run"><code title={track.lastSeenSyncId || ""}>{track.lastSeenSyncId ? track.lastSeenSyncId.slice(0, 8) : "â€”"}</code></td><td data-label="BPM"><span className={styles.bpmBadge}>{labelBpm(track.bpmStatus)}</span></td><td data-label="Actions"><button className={styles.tableAction} onClick={() => void checkMissing([track])}>Check &amp; restore</button></td>
            </tr>)}</tbody>
          </table>
          {!tracks.length && <div className={styles.empty}>No missing tracks match these filters.</div>}
        </div>
        <div className={styles.pagination}><span>{formatNumber(pagination.total)} missing track{pagination.total === 1 ? "" : "s"}</span><div><button disabled={page <= 1} onClick={() => { const next = page - 1; setPage(next); void loadMissing(appliedFilters, next); }}><ChevronLeft size={16} /></button><span>Page {pagination.page} of {pagination.totalPages}</span><button disabled={page >= pagination.totalPages} onClick={() => { const next = page + 1; setPage(next); void loadMissing(appliedFilters, next); }}><ChevronRight size={16} /></button></div></div>
      </section>

      {confirmCleanup && <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setConfirmCleanup(null)}><div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="cleanup-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.modalIcon}><ShieldAlert size={24} /></div><h3 id="cleanup-title">Permanently delete {confirmCleanup.count} track record{confirmCleanup.count === 1 ? "" : "s"}?</h3><p>You are about to delete {confirmCleanup.label}.</p><p className={styles.warningText}>This permanently removes Mixarr database records for tracks that are currently missing from Plex. This does not delete files from disk or Plex.</p><div className={styles.modalActions}><button className={styles.secondaryButton} onClick={() => setConfirmCleanup(null)}>Cancel</button><button className={styles.dangerButton} disabled={!confirmCleanup.count || working === "cleanup"} onClick={() => void executeCleanup()}>{working === "cleanup" ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />} Permanently delete</button></div>
      </div></div>}
    </div>
  );
}


