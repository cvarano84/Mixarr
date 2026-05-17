"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Plus, Trash2, Play, Upload, Star, Music, Shuffle, Activity, Save, RefreshCw, Pin, X, GripVertical } from "lucide-react";
import BlockTrackButton from "@/components/BlockTrackButton";
import TrackPreviewButton from "@/components/TrackPreviewButton";
import styles from "./builder.module.css";

type Rule = {
  field: string;
  operator: string;
  value: string;
};

type RuleGroup = {
  id: string;
  combinator: "AND" | "OR";
  rules: Rule[];
};

type NegativeFilters = {
  excludeHoliday: boolean;
  excludeLive: boolean;
  excludeRemasters: boolean;
  excludeExplicit: boolean;
  excludeIntroOutro: boolean;
  minRating: string;
  excludePlayedWithinDays: string;
  minDurationMinutes: string;
  maxDurationMinutes: string;
};

type SavedRule = {
  id: string;
  name: string;
  rules: Rule[];
  ruleTree?: any;
  options?: any;
  limit: number;
  autoRefresh: boolean;
  serverId?: string | null;
  libraryId?: string | null;
  plexPlaylistId?: string | null;
  lastRefreshedAt?: string | null;
  lastRefreshStatus?: string | null;
  lastRefreshError?: string | null;
};

export default function BuilderPage() {
  const [rules, setRules] = useState<Rule[]>([{ field: "popularity", operator: "gt", value: "50" }]);
  const [rootCombinator, setRootCombinator] = useState<"AND" | "OR">("AND");
  const [ruleGroups, setRuleGroups] = useState<RuleGroup[]>([]);
  const [limit, setLimit] = useState(50);
  const [playlistName, setPlaylistName] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [serverId, setServerId] = useState("");
  const [libraryId, setLibraryId] = useState("");
  const [duplicateStrategy, setDuplicateStrategy] = useState<"allow" | "song_artist">("song_artist");
  const [preferNonLive, setPreferNonLive] = useState(true);
  const [excludeRemasters, setExcludeRemasters] = useState(false);
  const [negativeFilters, setNegativeFilters] = useState<NegativeFilters>({
    excludeHoliday: false,
    excludeLive: false,
    excludeRemasters: false,
    excludeExplicit: false,
    excludeIntroOutro: false,
    minRating: "",
    excludePlayedWithinDays: "",
    minDurationMinutes: "",
    maxDurationMinutes: "",
  });
  const [pinnedTrackIds, setPinnedTrackIds] = useState<string[]>([]);
  const [excludedTrackIds, setExcludedTrackIds] = useState<string[]>([]);
  const [draggedTrackId, setDraggedTrackId] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [savedRules, setSavedRules] = useState<SavedRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [tracks, setTracks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSavedRules();
    fetchDefaults();
    fetchHistory();
  }, []);

  useEffect(() => {
    const sourceParams = new URLSearchParams(window.location.search);
    const source = sourceParams.get("from");
    if (!source) return;

    const genre = sourceParams.get("genre") || "";
    const q = sourceParams.get("q") || "";
    const minPopularity = sourceParams.get("minPopularity") || "";
    const trait = sourceParams.get("trait") || "";
    const importedRules: Rule[] = [];
    const importedGroups: RuleGroup[] = [];

    if (genre) importedRules.push({ field: "genre", operator: "contains", value: genre });
    if (minPopularity) importedRules.push({ field: "popularity", operator: "gte", value: minPopularity });
    if (trait === "unplayed") importedRules.push({ field: "playCount", operator: "eq", value: "0" });
    if (trait === "played") importedRules.push({ field: "playCount", operator: "gt", value: "0" });
    if (trait === "rated") importedRules.push({ field: "rating", operator: "gt", value: "0" });
    if (trait === "live") importedRules.push({ field: "isLive", operator: "eq", value: "true" });
    if (trait === "remaster") importedRules.push({ field: "isRemaster", operator: "eq", value: "true" });
    if (trait === "explicit") importedRules.push({ field: "isExplicit", operator: "eq", value: "true" });
    if (trait === "missingPopularity") importedRules.push({ field: "hasPopularity", operator: "eq", value: "false" });

    if (q) {
      importedGroups.push({
        id: "imported-search",
        combinator: "OR",
        rules: [
          { field: "title", operator: "contains", value: q },
          { field: "artist", operator: "contains", value: q },
          { field: "album", operator: "contains", value: q },
        ],
      });
    }

    if (importedRules.length === 0 && importedGroups.length === 0) return;

    setRootCombinator("AND");
    setRules(importedRules);
    setRuleGroups(importedGroups);
    setPlaylistName(genre ? `${genre} Mix` : q ? `${q} Mix` : "Filtered Library Mix");
    setSelectedRuleId("");
    setPinnedTrackIds([]);
    setExcludedTrackIds([]);
    setTracks([]);
  }, []);

  const fetchSavedRules = async () => {
    try {
      const res = await axios.get("/api/playlists/rules");
      setSavedRules(res.data.rules || []);
    } catch (e) {
      console.error("Failed to load saved playlists", e);
    }
  };

  const fetchDefaults = async () => {
    try {
      const res = await axios.get("/api/settings/library-selection");
      setServerId(res.data.defaultServerId || "");
      setLibraryId(res.data.defaultLibraryId || "");
    } catch (e) {
      console.error("Failed to load default library", e);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await axios.get("/api/playlists/history");
      setHistory(res.data.history || []);
    } catch (e) {
      console.error("Failed to load playlist history", e);
    }
  };

  const buildRuleTree = () => {
    const children: any[] = [];
    if (rules.length > 0) {
      children.push({ type: "group", combinator: "AND", children: rules.map(rule => ({ type: "rule", ...rule })) });
    }
    for (const group of ruleGroups) {
      children.push({ type: "group", combinator: group.combinator, children: group.rules.map(rule => ({ type: "rule", ...rule })) });
    }
    if (children.length === 0) return undefined;
    if (children.length === 1 && rootCombinator === "AND") return children[0];
    return { type: "group", combinator: rootCombinator, children };
  };

  const restoreRuleTree = (tree: any, fallbackRules: Rule[]) => {
    if (!tree) {
      setRootCombinator("AND");
      setRules(fallbackRules?.length ? fallbackRules : [{ field: "popularity", operator: "gt", value: "50" }]);
      setRuleGroups([]);
      return;
    }

    if (tree.type !== "group") {
      setRootCombinator("AND");
      setRules([{ field: tree.field, operator: tree.operator, value: tree.value }]);
      setRuleGroups([]);
      return;
    }

    setRootCombinator(tree.combinator || "AND");
    const childGroups = tree.children || [];
    const mainGroup = childGroups.find((child: any) => child.type === "group" && child.combinator === "AND") || childGroups[0];
    setRules((mainGroup?.children || []).filter((child: any) => child.type !== "group").map((child: any) => ({ field: child.field, operator: child.operator, value: child.value })));
    setRuleGroups(childGroups.filter((child: any) => child !== mainGroup && child.type === "group").map((child: any) => ({
      id: `${Date.now()}-${Math.random()}`,
      combinator: child.combinator || "OR",
      rules: (child.children || []).filter((grandchild: any) => grandchild.type !== "group").map((grandchild: any) => ({ field: grandchild.field, operator: grandchild.operator, value: grandchild.value })),
    })));
  };

  const playlistPayload = (extra: Record<string, any> = {}) => ({
    rules,
    ruleTree: buildRuleTree(),
    limit,
    serverId: serverId || undefined,
    libraryId: libraryId || undefined,
    duplicateStrategy,
    preferNonLive,
    excludeRemasters,
    negativeFilters: {
      ...negativeFilters,
      minRating: negativeFilters.minRating || undefined,
      excludePlayedWithinDays: negativeFilters.excludePlayedWithinDays || undefined,
      minDurationMinutes: negativeFilters.minDurationMinutes || undefined,
      maxDurationMinutes: negativeFilters.maxDurationMinutes || undefined,
    },
    ...extra,
  });

  const addRule = () => {
    setRules([...rules, { field: "genre", operator: "contains", value: "" }]);
    setTracks([]);
  };

  const removeRule = (index: number) => {
    setRules(rules.filter((_, i) => i !== index));
    setTracks([]);
  };

  const updateRule = (index: number, key: keyof Rule, val: string) => {
    const newRules = [...rules];
    newRules[index][key] = val;
    setRules(newRules);
    setTracks([]);
  };

  const addGroup = () => {
    setRuleGroups([...ruleGroups, { id: `${Date.now()}-${Math.random()}`, combinator: "OR", rules: [{ field: "genre", operator: "contains", value: "" }] }]);
    setTracks([]);
  };

  const updateGroup = (groupId: string, patch: Partial<RuleGroup>) => {
    setRuleGroups(ruleGroups.map(group => group.id === groupId ? { ...group, ...patch } : group));
    setTracks([]);
  };

  const updateGroupRule = (groupId: string, index: number, key: keyof Rule, val: string) => {
    setRuleGroups(ruleGroups.map(group => {
      if (group.id !== groupId) return group;
      const nextRules = [...group.rules];
      nextRules[index][key] = val;
      return { ...group, rules: nextRules };
    }));
    setTracks([]);
  };

  const addGroupRule = (groupId: string) => {
    setRuleGroups(ruleGroups.map(group => group.id === groupId ? { ...group, rules: [...group.rules, { field: "genre", operator: "contains", value: "" }] } : group));
    setTracks([]);
  };

  const removeGroupRule = (groupId: string, index: number) => {
    setRuleGroups(ruleGroups.map(group => group.id === groupId ? { ...group, rules: group.rules.filter((_, i) => i !== index) } : group));
    setTracks([]);
  };

  const loadSavedRule = (id: string) => {
    setSelectedRuleId(id);
    if (!id) return;

    const savedRule = savedRules.find(rule => rule.id === id);
    if (!savedRule) return;

    setPlaylistName(savedRule.name);
    restoreRuleTree(savedRule.ruleTree, savedRule.rules);
    setLimit(savedRule.limit);
    setAutoRefresh(savedRule.autoRefresh);
    setServerId(savedRule.serverId || "");
    setLibraryId(savedRule.libraryId || "");
    setDuplicateStrategy(savedRule.options?.duplicateStrategy || "song_artist");
    setPreferNonLive(savedRule.options?.preferNonLive ?? true);
    setExcludeRemasters(savedRule.options?.excludeRemasters || false);
    setNegativeFilters({
      excludeHoliday: savedRule.options?.negativeFilters?.excludeHoliday || false,
      excludeLive: savedRule.options?.negativeFilters?.excludeLive || false,
      excludeRemasters: savedRule.options?.negativeFilters?.excludeRemasters || false,
      excludeExplicit: savedRule.options?.negativeFilters?.excludeExplicit || false,
      excludeIntroOutro: savedRule.options?.negativeFilters?.excludeIntroOutro || false,
      minRating: savedRule.options?.negativeFilters?.minRating?.toString() || "",
      excludePlayedWithinDays: savedRule.options?.negativeFilters?.excludePlayedWithinDays?.toString() || "",
      minDurationMinutes: savedRule.options?.negativeFilters?.minDurationMinutes?.toString() || "",
      maxDurationMinutes: savedRule.options?.negativeFilters?.maxDurationMinutes?.toString() || "",
    });
    setPinnedTrackIds([]);
    setExcludedTrackIds([]);
    setTracks([]);
  };

  const saveSmartPlaylist = async (showAlert = true) => {
    if (!playlistName.trim()) {
      alert("Please enter a playlist name");
      return "";
    }

    setSaving(true);
    try {
      const payload = { name: playlistName, autoRefresh, ...playlistPayload() };
      const res = selectedRuleId
        ? await axios.put(`/api/playlists/rules/${selectedRuleId}`, payload)
        : await axios.post("/api/playlists/rules", payload);

      setSelectedRuleId(res.data.rule.id);
      await fetchSavedRules();
      if (showAlert) alert("Smart playlist saved");
      return res.data.rule.id;
    } catch (e) {
      console.error(e);
      alert("Failed to save smart playlist");
      return "";
    } finally {
      setSaving(false);
    }
  };

  const refreshSelectedPlaylist = async () => {
    if (!selectedRuleId) return;

    setSaving(true);
    try {
      await axios.post(`/api/playlists/rules/${selectedRuleId}/refresh`);
      await fetchSavedRules();
      alert("Smart playlist refreshed in Plex");
    } catch (e) {
      console.error(e);
      alert("Export this saved playlist once before refreshing it");
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = (templateName: string) => {
    if (templateName === "deep_cuts") {
      setRules([{ field: "popularity", operator: "lt", value: "30" }]);
      setPlaylistName("Deep Cuts Discovered");
    } else if (templateName === "90s") {
      setRules([
        { field: "year", operator: "gte", value: "1990" },
        { field: "year", operator: "lte", value: "1999" }
      ]);
      setPlaylistName("Ultimate 90s Mix");
    } else if (templateName === "christmas") {
      setRules([
        { field: "title", operator: "contains", value: "Christmas" }
      ]);
      setPlaylistName("Christmas Cheer");
    } else if (templateName === "anti_christmas") {
      setRules([
        { field: "title", operator: "not_contains", value: "Christmas" },
        { field: "title", operator: "not_contains", value: "Holiday" }
      ]);
      setNegativeFilters({ ...negativeFilters, excludeHoliday: true });
      setPlaylistName("No Holidays Allowed");
    } else if (templateName === "workout") {
      setRules([
        { field: "tempo", operator: "gte", value: "120" },
        { field: "energy", operator: "gte", value: "0.7" }
      ]);
      setPlaylistName("High BPM Workout Mix");
    }
    setSelectedRuleId("");
    setRuleGroups([]);
    setPinnedTrackIds([]);
    setExcludedTrackIds([]);
    setTracks([]);
  };

  const previewPlaylist = async () => {
    setLoading(true);
    try {
      setPinnedTrackIds([]);
      setExcludedTrackIds([]);
      const res = await axios.post("/api/playlists/generate", playlistPayload());
      setTracks(res.data.tracks);
    } catch (e) {
      console.error(e);
      alert("Failed to generate preview");
    } finally {
      setLoading(false);
    }
  };

  const regenerateUnpinned = async () => {
    setLoading(true);
    try {
      const res = await axios.post("/api/playlists/generate", playlistPayload({
        pinnedTrackIds,
        excludedTrackIds,
      }));
      setTracks(res.data.tracks);
      setPinnedTrackIds(res.data.tracks.filter((track: any) => pinnedTrackIds.includes(track.id)).map((track: any) => track.id));
    } catch (e) {
      console.error(e);
      alert("Failed to regenerate preview");
    } finally {
      setLoading(false);
    }
  };

  const removeTrack = (trackId: string) => {
    setTracks(tracks.filter(track => track.id !== trackId));
    setPinnedTrackIds(pinnedTrackIds.filter(id => id !== trackId));
    setExcludedTrackIds([...excludedTrackIds, trackId]);
  };

  const togglePin = (trackId: string) => {
    setPinnedTrackIds(pinnedTrackIds.includes(trackId)
      ? pinnedTrackIds.filter(id => id !== trackId)
      : [...pinnedTrackIds, trackId]);
  };

  const moveDraggedTrack = (targetTrackId: string) => {
    if (!draggedTrackId || draggedTrackId === targetTrackId) return;
    const draggedIndex = tracks.findIndex(track => track.id === draggedTrackId);
    const targetIndex = tracks.findIndex(track => track.id === targetTrackId);
    if (draggedIndex === -1 || targetIndex === -1) return;

    const nextTracks = [...tracks];
    const [draggedTrack] = nextTracks.splice(draggedIndex, 1);
    nextTracks.splice(targetIndex, 0, draggedTrack);
    setTracks(nextTracks);
    setPinnedTrackIds(nextTracks.filter(track => pinnedTrackIds.includes(track.id)).map(track => track.id));
    setDraggedTrackId("");
  };

  const exportToPlex = async () => {
    if (!playlistName) {
      alert("Please enter a playlist name");
      return;
    }
    if (tracks.length === 0) {
      alert("Please preview tracks first to ensure the playlist is not empty");
      return;
    }
    setExporting(true);
    try {
      const savedRuleId = autoRefresh || selectedRuleId
        ? await saveSmartPlaylist(false)
        : "";
      if ((autoRefresh || selectedRuleId) && !savedRuleId) return;

      await axios.post("/api/playlists/export", {
        name: playlistName,
        trackIds: tracks.map(t => t.id),
        savedRuleId: savedRuleId || undefined,
        rulesSnapshot: buildRuleTree() || rules,
        optionsSnapshot: playlistPayload({ pinnedTrackIds: [], excludedTrackIds: [] })
      });
      await fetchSavedRules();
      await fetchHistory();
      alert("Playlist exported to Plex successfully!");
    } catch (e) {
      console.error(e);
      alert("Failed to export to Plex");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="builder-container">
      {/* LEFT COLUMN: BUILDER */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <header className={styles.header}>
          <h2>Playlist Builder</h2>
          <p>Create dynamic mixes using cached metadata</p>
        </header>

        {/* Saved Smart Playlists */}
        <div className={`glass-panel ${styles.panel}`}>
          <h3>Saved Smart Playlists</h3>
          <div className={styles.savedBar}>
            <select value={selectedRuleId} onChange={(e) => loadSavedRule(e.target.value)} className={styles.savedBarSelect}>
              <option value="">New smart playlist</option>
              {savedRules.map(rule => (
                <option key={rule.id} value={rule.id}>
                  {rule.name}{rule.autoRefresh ? " (auto)" : ""}
                </option>
              ))}
            </select>
            <label className={styles.savedCheck}>
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              Auto-refresh after export
            </label>
            <button onClick={() => saveSmartPlaylist()} disabled={saving} className={styles.btnSecondary}>
              {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
              {selectedRuleId ? "Update" : "Save"}
            </button>
            {selectedRuleId && (
              <button onClick={refreshSelectedPlaylist} disabled={saving} className={styles.btnSecondary}>
                <RefreshCw size={16} />
                Refresh Plex
              </button>
            )}
          </div>
          {selectedRuleId && savedRules.find(rule => rule.id === selectedRuleId)?.lastRefreshedAt && (
            <p className={styles.savedTimestamp}>
              Last Plex refresh: {new Date(savedRules.find(rule => rule.id === selectedRuleId)!.lastRefreshedAt!).toLocaleString()}
            </p>
          )}
        </div>

        {/* Quick Templates */}
        <div className={`glass-panel ${styles.panel}`}>
          <h3>Quick Templates</h3>
          <div className={styles.templateRow}>
            <button onClick={() => applyTemplate("deep_cuts")} className={styles.btnTemplate}><Shuffle size={14} /> Deep Cuts</button>
            <button onClick={() => applyTemplate("90s")} className={styles.btnTemplate}><Music size={14} /> 90s Decade</button>
            <button onClick={() => applyTemplate("workout")} className={styles.btnTemplate}><Activity size={14} /> Workout (High BPM)</button>
            <button onClick={() => applyTemplate("christmas")} className={styles.btnTemplate}><Star size={14} /> Seasonal</button>
            <button onClick={() => applyTemplate("anti_christmas")} className={styles.btnTemplate}>Anti-Seasonal</button>
          </div>
        </div>

        {/* Playlist Behavior */}
        <div className={`glass-panel ${styles.panel}`}>
          <h3>Playlist Behavior</h3>
          <div className={styles.behaviorGrid}>
            <div className={styles.behaviorRow}>
              <label className={styles.optionLabel}>
                Duplicate Control
                <select value={duplicateStrategy} onChange={(e) => { setDuplicateStrategy(e.target.value as "allow" | "song_artist"); setTracks([]); }} className={styles.select}>
                  <option value="song_artist">One version per song</option>
                  <option value="allow">Allow duplicates</option>
                </select>
              </label>
              <label className={styles.optionLabel}>
                Top-Level Groups
                <select value={rootCombinator} onChange={(e) => { setRootCombinator(e.target.value as "AND" | "OR"); setTracks([]); }} className={styles.select}>
                  <option value="AND">Match all groups</option>
                  <option value="OR">Match any group</option>
                </select>
              </label>
            </div>
            <div className={styles.checkGroup}>
              <label className={styles.checkLabel}><input type="checkbox" checked={preferNonLive} onChange={(e) => { setPreferNonLive(e.target.checked); setTracks([]); }} /> Prefer non-live duplicates</label>
              <label className={styles.checkLabel}><input type="checkbox" checked={excludeRemasters} onChange={(e) => { setExcludeRemasters(e.target.checked); setTracks([]); }} /> Exclude remasters</label>
              <label className={styles.checkLabel}><input type="checkbox" checked={negativeFilters.excludeHoliday} onChange={(e) => setNegativeFilters({ ...negativeFilters, excludeHoliday: e.target.checked })} /> Exclude holiday tracks</label>
              <label className={styles.checkLabel}><input type="checkbox" checked={negativeFilters.excludeLive} onChange={(e) => setNegativeFilters({ ...negativeFilters, excludeLive: e.target.checked })} /> Exclude live tracks</label>
              <label className={styles.checkLabel}><input type="checkbox" checked={negativeFilters.excludeExplicit} onChange={(e) => setNegativeFilters({ ...negativeFilters, excludeExplicit: e.target.checked })} /> Exclude explicit tracks</label>
              <label className={styles.checkLabel}><input type="checkbox" checked={negativeFilters.excludeIntroOutro} onChange={(e) => setNegativeFilters({ ...negativeFilters, excludeIntroOutro: e.target.checked })} /> Exclude intros/outros</label>
            </div>
            <div className={styles.behaviorRow}>
              <label className={styles.optionLabel}>Min Rating<input value={negativeFilters.minRating} onChange={(e) => setNegativeFilters({ ...negativeFilters, minRating: e.target.value })} placeholder="0-10" className={styles.input} /></label>
              <label className={styles.optionLabel}>Not Played Days<input value={negativeFilters.excludePlayedWithinDays} onChange={(e) => setNegativeFilters({ ...negativeFilters, excludePlayedWithinDays: e.target.value })} placeholder="30" className={styles.input} /></label>
              <label className={styles.optionLabel}>Min Minutes<input value={negativeFilters.minDurationMinutes} onChange={(e) => setNegativeFilters({ ...negativeFilters, minDurationMinutes: e.target.value })} placeholder="1" className={styles.input} /></label>
              <label className={styles.optionLabel}>Max Minutes<input value={negativeFilters.maxDurationMinutes} onChange={(e) => setNegativeFilters({ ...negativeFilters, maxDurationMinutes: e.target.value })} placeholder="8" className={styles.input} /></label>
            </div>
          </div>
        </div>

        {/* Rule Builder */}
        <div className={`glass-panel ${styles.rulePanel}`}>
          <div className={styles.ruleHeader}>
            <div>
              <h3>Matching Rules</h3>
              <p className={styles.panelSubtext}>
                <strong>Cheat Sheet:</strong> Happy (Energy: 0.7, Mood: 0.9) | Relaxed (E: 0.2, M: 0.6) | Aggressive (E: 0.9, M: 0.3) | Sad (E: 0.3, M: 0.2)
              </p>
            </div>
            <div className={styles.ruleHeaderActions}>
              <button onClick={addRule} className={styles.btnGhost}>
                <Plus size={16} /> Add Rule
              </button>
              <button onClick={addGroup} className={styles.btnGhost}>
                <Plus size={16} /> Add OR Group
              </button>
            </div>
          </div>

          <div className={styles.ruleList}>
            {rules.map((rule, i) => (
              <div key={i} className={styles.ruleRow}>
                <select
                  value={rule.field}
                  onChange={(e) => updateRule(i, "field", e.target.value)}
                  className={styles.select}
                >
                  <option value="popularity">Popularity Score (0-100)</option>
                  <option value="energy">Energy (0.0-1.0)</option>
                  <option value="valence">Mood/Valence (0.0-1.0)</option>
                  <option value="tempo">BPM (Beats Per Minute) / Tempo</option>
                  <option value="year">Release Year</option>
                  <option value="duration">Duration (ms)</option>
                  <option value="rating">Plex Rating</option>
                  <option value="playCount">Play Count</option>
                  <option value="isLive">Live Track</option>
                  <option value="isRemaster">Remaster</option>
                  <option value="isExplicit">Explicit</option>
                  <option value="hasPopularity">Has Popularity Score</option>
                  <option value="genre">Genre Tag</option>
                  <option value="artist">Artist Name</option>
                  <option value="album">Album Title</option>
                  <option value="title">Track Title</option>
                </select>

                <select
                  value={rule.operator}
                  onChange={(e) => updateRule(i, "operator", e.target.value)}
                  className={styles.select}
                >
                  <option value="eq">Equals (=)</option>
                  <option value="contains">Contains</option>
                  <option value="not_contains">Does Not Contain</option>
                  <option value="gt">Greater Than (&gt;)</option>
                  <option value="lt">Less Than (&lt;)</option>
                  <option value="gte">Greater or Equal (&ge;)</option>
                  <option value="lte">Less or Equal (&le;)</option>
                </select>

                <input
                  type="text"
                  value={rule.value}
                  onChange={(e) => updateRule(i, "value", e.target.value)}
                  placeholder="Value..."
                  className={styles.input}
                  style={{ flex: 1 }}
                />

                <button onClick={() => removeRule(i)} className={styles.btnGhostDanger}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {ruleGroups.map((group) => (
              <div key={group.id} className={styles.ruleGroupBox}>
                <div className={styles.ruleGroupHeader}>
                  <select value={group.combinator} onChange={(e) => updateGroup(group.id, { combinator: e.target.value as "AND" | "OR" })} className={styles.select}>
                    <option value="OR">Any rule in this group</option>
                    <option value="AND">All rules in this group</option>
                  </select>
                  <button onClick={() => setRuleGroups(ruleGroups.filter(item => item.id !== group.id))} className={styles.btnGhostDanger}>
                    <Trash2 size={16} />
                  </button>
                </div>
                {group.rules.map((rule, i) => (
                  <div key={i} className={styles.ruleRow}>
                    <select value={rule.field} onChange={(e) => updateGroupRule(group.id, i, "field", e.target.value)} className={styles.select}>
                      <option value="popularity">Popularity Score (0-100)</option>
                      <option value="energy">Energy (0.0-1.0)</option>
                      <option value="valence">Mood/Valence (0.0-1.0)</option>
                      <option value="tempo">BPM / Tempo</option>
                      <option value="year">Release Year</option>
                      <option value="duration">Duration (ms)</option>
                      <option value="rating">Plex Rating</option>
                      <option value="playCount">Play Count</option>
                      <option value="isLive">Live Track</option>
                      <option value="isRemaster">Remaster</option>
                      <option value="isExplicit">Explicit</option>
                      <option value="hasPopularity">Has Popularity Score</option>
                      <option value="genre">Genre Tag</option>
                      <option value="artist">Artist Name</option>
                      <option value="album">Album Title</option>
                      <option value="title">Track Title</option>
                    </select>
                    <select value={rule.operator} onChange={(e) => updateGroupRule(group.id, i, "operator", e.target.value)} className={styles.select}>
                      <option value="eq">Equals (=)</option>
                      <option value="contains">Contains</option>
                      <option value="not_contains">Does Not Contain</option>
                      <option value="gt">Greater Than (&gt;)</option>
                      <option value="lt">Less Than (&lt;)</option>
                      <option value="gte">Greater or Equal (&ge;)</option>
                      <option value="lte">Less or Equal (&le;)</option>
                    </select>
                    <input type="text" value={rule.value} onChange={(e) => updateGroupRule(group.id, i, "value", e.target.value)} placeholder="Value..." className={styles.input} style={{ flex: 1 }} />
                    <button onClick={() => removeGroupRule(group.id, i)} className={styles.btnGhostDanger}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <button onClick={() => addGroupRule(group.id)} className={styles.btnGhost}>
                  <Plus size={16} /> Add Group Rule
                </button>
              </div>
            ))}
          </div>

          <div className={styles.ruleFooter}>
            <div className={styles.limitLabel}>
              <label>Track Limit:</label>
              <input type="number" value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setTracks([]); }} className={styles.limitInput} />
            </div>
            <button onClick={previewPlaylist} disabled={loading} className={styles.btnPrimary} style={{ marginLeft: "auto" }}>
              <Play size={16} /> {loading ? "Querying..." : "Preview Playlist"}
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: PREVIEW */}
      <div className={`glass-panel ${styles.previewPanel}`}>
        <div className={styles.previewHeader}>
          <h3>Playlist Preview</h3>
          <button onClick={regenerateUnpinned} disabled={loading || tracks.length === 0} className={styles.btnSecondary}>
            <RefreshCw size={14} /> Regenerate Open Slots
          </button>
        </div>

        <div className={styles.previewNameRow}>
          <input
            type="text"
            placeholder="Name your playlist..."
            value={playlistName}
            onChange={(e) => setPlaylistName(e.target.value)}
            className={styles.previewNameInput}
          />
          <button onClick={exportToPlex} disabled={exporting || tracks.length === 0} className={styles.btnPrimary}>
            <Upload size={16} /> {exporting ? "Pushing..." : "Push to Plex"}
          </button>
        </div>

        <div className="table-container">
          {tracks.length === 0 ? (
            <div className={styles.emptyPreview}>
              Click Preview Playlist to see results
            </div>
          ) : (
            <table className={styles.previewTable}>
              <thead>
                <tr>
                  <th className={styles.colIndex}>#</th>
                  <th className={styles.colActions}></th>
                  <th>Track</th>
                  <th>Artist</th>
                  <th className={styles.colBpm}>BPM</th>
                  <th className={styles.colPop}>Pop</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {tracks.map((track, idx) => (
                  <tr
                    key={track.id}
                    draggable
                    onDragStart={() => setDraggedTrackId(track.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => moveDraggedTrack(track.id)}
                  >
                    <td style={{ color: "var(--faint)" }}>{idx + 1}</td>
                    <td>
                      <div className={styles.actionGroup}>
                        <button title="Drag row" className={styles.btnIcon}><GripVertical size={14} /></button>
                        <button title={pinnedTrackIds.includes(track.id) ? "Unpin" : "Pin"} onClick={() => togglePin(track.id)} className={`${styles.btnIcon} ${pinnedTrackIds.includes(track.id) ? styles.pinActive : ""}`}><Pin size={14} /></button>
                        <button title="Remove from this preview" onClick={() => removeTrack(track.id)} className={styles.btnIcon}><X size={14} /></button>
                        <TrackPreviewButton trackId={track.id} />
                        <BlockTrackButton trackId={track.id} onBlocked={removeTrack} />
                      </div>
                    </td>
                    <td className={styles.trackTitle}>
                      {track.title}
                      {(track.isLive || track.isRemaster || track.isExplicit) && (
                        <div className={styles.badgeRow}>
                          {track.isLive && <span className={styles.miniBadge}>Live</span>}
                          {track.isRemaster && <span className={styles.miniBadge}>Remaster</span>}
                          {track.isExplicit && <span className={styles.miniBadge}>Explicit</span>}
                        </div>
                      )}
                    </td>
                    <td className={styles.trackArtist}>{track.artist?.title}</td>
                    <td className={styles.trackBpm}>
                      {track.audioFeature?.tempo?.toFixed(0) || "-"}
                      {track.metadataConfidence?.audio?.tempoLabel && <div className={styles.trackBpmLabel}>{track.metadataConfidence.audio.tempoLabel}</div>}
                    </td>
                    <td className={styles.trackPop}>{track.popularity?.score?.toFixed(0) || "-"}</td>
                    <td className={styles.trackWhy}>
                      {(track.matchReasons || []).slice(0, 2).join(" | ") || "Matched selected rules"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className={styles.previewCount}>
          {tracks.length} tracks matched
        </div>
        {history.length > 0 && (
          <div className={styles.historySection}>
            <h4>Recent Playlist History</h4>
            <div className={styles.historyList}>
              {history.slice(0, 5).map((item) => (
                <div key={item.id} className={styles.historyItem}>
                  <span>{item.name} ({item.trackCount})</span>
                  <span className={item.status === "success" ? styles.historySuccess : styles.historyFail}>{item.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
