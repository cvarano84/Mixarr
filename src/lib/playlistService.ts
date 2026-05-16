import axios from "axios";
import { z } from "zod";
import prisma from "./prisma";

const numericFields = ["popularity", "energy", "valence", "tempo", "year", "duration", "rating", "playCount"] as const;
const booleanFields = ["isLive", "isRemaster", "isExplicit", "hasPopularity"] as const;
const fields = ["popularity", "energy", "valence", "tempo", "year", "duration", "rating", "playCount", "isLive", "isRemaster", "isExplicit", "hasPopularity", "genre", "title", "artist", "album"] as const;
const operators = ["eq", "contains", "not_contains", "gt", "lt", "gte", "lte"] as const;
const combinators = ["AND", "OR"] as const;
const duplicateStrategies = ["allow", "song_artist"] as const;

const maxPlaylistSize = Number(process.env.MAX_PLAYLIST_SIZE || 5000);

export const playlistRuleSchema = z.object({
  type: z.literal("rule").optional(),
  field: z.enum(fields),
  operator: z.enum(operators),
  value: z.string().trim().min(1).max(200),
});

type RuleNode = z.infer<typeof playlistRuleSchema> | {
  type: "group";
  combinator: "AND" | "OR";
  children: RuleNode[];
};

let ruleNodeSchema: z.ZodType<RuleNode>;
ruleNodeSchema = z.lazy(() => z.union([
  playlistRuleSchema,
  z.object({
    type: z.literal("group"),
    combinator: z.enum(combinators),
    children: z.array(ruleNodeSchema).min(1).max(25),
  }),
]));
export const playlistRuleNodeSchema = ruleNodeSchema;

export const negativeFiltersSchema = z.object({
  excludeHoliday: z.boolean().default(false),
  excludeLive: z.boolean().default(false),
  excludeRemasters: z.boolean().default(false),
  excludeExplicit: z.boolean().default(false),
  excludeIntroOutro: z.boolean().default(false),
  minRating: z.coerce.number().min(0).max(10).optional().nullable(),
  excludePlayedWithinDays: z.coerce.number().int().min(1).max(3650).optional().nullable(),
  minDurationMinutes: z.coerce.number().min(0).max(120).optional().nullable(),
  maxDurationMinutes: z.coerce.number().min(0).max(120).optional().nullable(),
}).default({});

export const playlistOptionsSchema = z.object({
  duplicateStrategy: z.enum(duplicateStrategies).default("song_artist"),
  preferNonLive: z.boolean().default(true),
  excludeRemasters: z.boolean().default(false),
  negativeFilters: negativeFiltersSchema,
});

export const playlistConfigSchema = z.object({
  rules: z.array(playlistRuleSchema).max(25).default([]),
  ruleTree: playlistRuleNodeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(maxPlaylistSize).default(100),
  serverId: z.string().optional().nullable(),
  libraryId: z.string().optional().nullable(),
  pinnedTrackIds: z.array(z.string()).max(maxPlaylistSize).default([]),
  excludedTrackIds: z.array(z.string()).max(maxPlaylistSize).default([]),
}).merge(playlistOptionsSchema);

export const savedPlaylistSchema = playlistConfigSchema.extend({
  name: z.string().trim().min(1).max(120),
  autoRefresh: z.boolean().default(false),
});

export type PlaylistRuleInput = z.infer<typeof playlistRuleSchema>;
export type PlaylistConfigInput = z.infer<typeof playlistConfigSchema>;

const isNumericField = (field: string) => numericFields.includes(field as any);
const isBooleanField = (field: string) => booleanFields.includes(field as any);

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/\([^)]*(remaster|remastered|live|explicit|mono|stereo|deluxe|version)[^)]*\)/gi, "")
    .replace(/\[[^\]]*(remaster|remastered|live|explicit|mono|stereo|deluxe|version)[^\]]*\]/gi, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readableRule(rule: PlaylistRuleInput) {
  const field = rule.field === "playCount" ? "play count" : rule.field;
  const operatorMap: Record<string, string> = {
    eq: "is",
    contains: "contains",
    not_contains: "does not contain",
    gt: ">",
    lt: "<",
    gte: ">=",
    lte: "<=",
  };
  return `${field} ${operatorMap[rule.operator] || rule.operator} ${rule.value}`;
}

function collectRuleReasons(node: RuleNode | undefined, fallbackRules: PlaylistRuleInput[]): string[] {
  if (!node) return fallbackRules.map(readableRule);
  if (node.type !== "group") return [readableRule(node)];
  const childReasons = node.children.reduce<string[]>((reasons, child) => reasons.concat(collectRuleReasons(child, [])), []);
  return childReasons.length ? [`${node.combinator}: ${childReasons.join("; ")}`] : [];
}

function buildRuleCondition(rule: PlaylistRuleInput) {
  const { field, operator, value } = rule;
  let prismaCondition: any;

  if (isNumericField(field)) {
    const numValue = Number(value);
    if (!Number.isFinite(numValue)) {
      throw new Error(`Invalid numeric value for ${field}`);
    }

    if (operator === "eq" || operator === "contains" || operator === "not_contains") prismaCondition = numValue;
    else if (operator === "gt") prismaCondition = { gt: numValue };
    else if (operator === "lt") prismaCondition = { lt: numValue };
    else if (operator === "gte") prismaCondition = { gte: numValue };
    else if (operator === "lte") prismaCondition = { lte: numValue };
  } else if (isBooleanField(field)) {
    prismaCondition = ["true", "1", "yes"].includes(value.toLowerCase());
  } else {
    if (operator === "eq") prismaCondition = value;
    else if (operator === "contains" || operator === "not_contains") prismaCondition = { contains: value, mode: "insensitive" };
    else if (operator === "gt") prismaCondition = { gt: value };
    else if (operator === "lt") prismaCondition = { lt: value };
    else if (operator === "gte") prismaCondition = { gte: value };
    else if (operator === "lte") prismaCondition = { lte: value };
  }

  if (field === "popularity") return { popularity: { score: prismaCondition } };
  if (field === "energy") return { audioFeature: { energy: prismaCondition } };
  if (field === "valence") return { audioFeature: { valence: prismaCondition } };
  if (field === "tempo") return { audioFeature: { tempo: prismaCondition } };
  if (field === "year") return { album: { year: prismaCondition } };
  if (field === "duration") return { duration: prismaCondition };
  if (field === "rating") return { rating: prismaCondition };
  if (field === "playCount") return { viewCount: prismaCondition };
  if (field === "isLive") return { isLive: prismaCondition };
  if (field === "isRemaster") return { isRemaster: prismaCondition };
  if (field === "isExplicit") return { isExplicit: prismaCondition };
  if (field === "hasPopularity") return prismaCondition ? { popularity: { isNot: null } } : { popularity: null };
  if (field === "genre") {
    return {
      OR: [
        { artist: { tags: { some: { type: "genre", name: prismaCondition } } } },
        { tags: { some: { type: "genre", name: prismaCondition } } },
      ],
    };
  }
  if (field === "title") return { title: prismaCondition };
  if (field === "artist") return { artist: { title: prismaCondition } };
  if (field === "album") return { album: { title: prismaCondition } };

  throw new Error(`Unsupported field ${field}`);
}

function buildRuleNodeCondition(node: RuleNode): any {
  if (node.type === "group") {
    const childConditions = node.children.map(buildRuleNodeCondition);
    return { [node.combinator]: childConditions };
  }

  const condition = buildRuleCondition(node);
  return node.operator === "not_contains" ? { NOT: condition } : condition;
}

function buildNegativeConditions(config: PlaylistConfigInput) {
  const filters = config.negativeFilters || {};
  const conditions: any[] = [];

  if (filters.excludeHoliday) conditions.push({ isHoliday: false });
  if (filters.excludeLive) conditions.push({ isLive: false });
  if (filters.excludeRemasters || config.excludeRemasters) conditions.push({ isRemaster: false });
  if (filters.excludeExplicit) conditions.push({ isExplicit: false });
  if (filters.excludeIntroOutro) conditions.push({ isIntroOutro: false });
  if (filters.minRating != null) conditions.push({ rating: { gte: filters.minRating } });
  if (filters.excludePlayedWithinDays != null) {
    const threshold = new Date(Date.now() - filters.excludePlayedWithinDays * 24 * 60 * 60 * 1000);
    conditions.push({ OR: [{ lastViewedAt: null }, { lastViewedAt: { lt: threshold } }] });
  }
  if (filters.minDurationMinutes != null) conditions.push({ duration: { gte: Math.round(filters.minDurationMinutes * 60 * 1000) } });
  if (filters.maxDurationMinutes != null) conditions.push({ duration: { lte: Math.round(filters.maxDurationMinutes * 60 * 1000) } });

  return conditions;
}

export function buildTrackWhereClause(userId: string, config: PlaylistConfigInput, omitIds: string[] = []) {
  const scope: any = {
    library: {
      server: {
        userId,
        ...(config.serverId ? { id: config.serverId } : {}),
      },
      ...(config.libraryId ? { id: config.libraryId } : {}),
    },
  };

  const ruleCondition = config.ruleTree
    ? buildRuleNodeCondition(config.ruleTree)
    : { AND: config.rules.map((rule) => rule.operator === "not_contains" ? { NOT: buildRuleCondition(rule) } : buildRuleCondition(rule)) };

  const conditions = [scope, ruleCondition].concat(buildNegativeConditions(config));
  if (omitIds.length > 0) conditions.push({ id: { notIn: omitIds } });

  return { AND: conditions };
}

function duplicateKey(track: any) {
  return `${track.artistId}:${track.normalizedTitle || normalizeTitle(track.title)}`;
}

function duplicateScore(track: any, index: number, config: PlaylistConfigInput) {
  let score = 100000 - index;
  if (config.preferNonLive && !track.isLive) score += 10000;
  if (!track.isRemaster) score += 5000;
  if (track.popularity?.score) score += track.popularity.score;
  if (track.rating) score += track.rating;
  return score;
}

function applyDuplicatePolicy(tracks: any[], config: PlaylistConfigInput, limit: number) {
  if (config.duplicateStrategy === "allow") return tracks.slice(0, limit);

  const selected: any[] = [];
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    const key = duplicateKey(track);
    const existingIndex = selected.findIndex((candidate) => duplicateKey(candidate) === key);
    if (existingIndex === -1) {
      selected.push(track);
    } else if (duplicateScore(track, index, config) > duplicateScore(selected[existingIndex], existingIndex, config)) {
      selected[existingIndex] = track;
    }

    if (selected.length >= limit && tracks.length - index > limit) {
      continue;
    }
  }

  return selected.slice(0, limit);
}

function annotateTrack(track: any, reasons: string[]) {
  return {
    ...track,
    matchReasons: reasons,
    metadataConfidence: {
      popularity: track.popularity ? {
        provider: track.popularity.provider,
        confidence: track.popularity.confidence,
      } : null,
      audio: track.audioFeature ? {
        source: track.audioFeature.source,
        confidence: track.audioFeature.confidence,
        tempoSource: track.audioFeature.tempoSource,
        tempoConfidence: track.audioFeature.tempoConfidence,
        tempoLabel: track.audioFeature.tempoConfidence && track.audioFeature.tempoConfidence >= 0.75 ? "exact" : "estimated",
      } : null,
    },
  };
}

async function queryCandidateTracks(userId: string, config: PlaylistConfigInput, omitIds: string[], take: number) {
  return prisma.track.findMany({
    where: buildTrackWhereClause(userId, config, omitIds),
    include: {
      artist: true,
      album: true,
      popularity: true,
      audioFeature: true,
      library: { include: { server: true } },
    },
    take,
    orderBy: { popularity: { score: "desc" } },
  });
}

export async function generatePlaylistTracks({
  userId,
  config,
}: {
  userId: string;
  config: PlaylistConfigInput;
}) {
  const pinnedTracks = config.pinnedTrackIds.length
    ? await fetchOwnedTracksInOrder(userId, config.pinnedTrackIds)
    : [];
  const blockedTracks = await prisma.blockedTrack.findMany({
    where: { userId },
    select: { trackId: true },
  });
  const omittedIds = config.excludedTrackIds
    .concat(blockedTracks.map((track) => track.trackId))
    .concat(pinnedTracks.map((track) => track.id));
  const remainingLimit = Math.max(0, config.limit - pinnedTracks.length);
  const take = config.duplicateStrategy === "allow" ? remainingLimit : Math.max(remainingLimit * 5, remainingLimit + 25);
  const candidates = remainingLimit > 0 ? await queryCandidateTracks(userId, config, omittedIds, take) : [];
  const generatedTracks = applyDuplicatePolicy(candidates, config, remainingLimit);
  const reasons = collectRuleReasons(config.ruleTree, config.rules);

  return pinnedTracks.concat(generatedTracks).slice(0, config.limit).map((track) => annotateTrack(track, reasons));
}

async function fetchOwnedTracksInOrder(userId: string, trackIds: string[]) {
  const uniqueIds = trackIds.filter((id, index) => trackIds.indexOf(id) === index);
  const tracks = await prisma.track.findMany({
    where: {
      id: { in: uniqueIds },
      library: { server: { userId } },
    },
    include: { library: { include: { server: true } } },
  });

  if (tracks.length !== uniqueIds.length) {
    throw new Error("Some tracks were not found or are not owned by this user");
  }

  const trackById = new Map(tracks.map((track) => [track.id, track]));
  return uniqueIds.map((id) => trackById.get(id)!);
}

function assertSingleServer(tracks: Awaited<ReturnType<typeof fetchOwnedTracksInOrder>>) {
  const targetServer = tracks[0]?.library.server;
  if (!targetServer) throw new Error("No tracks were provided");

  const mixedServer = tracks.some((track) => track.library.server.id !== targetServer.id);
  if (mixedServer) {
    throw new Error("Plex playlists cannot span multiple servers");
  }

  return targetServer;
}

function plexHeaders(accessToken: string) {
  return {
    Accept: "application/json",
    "X-Plex-Token": accessToken,
    "X-Plex-Client-Identifier": (process.env.PLEX_CLIENT_IDENTIFIER || "mixarr").trim(),
  };
}

async function pushTracksToPlex({
  server,
  name,
  ratingKeys,
  playlistId,
}: {
  server: { uri: string; accessToken: string; machineIdentifier: string };
  name: string;
  ratingKeys: string[];
  playlistId?: string | null;
}) {
  const uri = `server://${server.machineIdentifier}/com.plexapp.plugins.library/library/metadata/${ratingKeys.join(",")}`;
  const headers = plexHeaders(server.accessToken);

  if (playlistId) {
    await axios.put(`${server.uri}/playlists/${playlistId}`, null, {
      params: { title: name },
      headers,
    }).catch(() => undefined);
    await axios.delete(`${server.uri}/playlists/${playlistId}/items`, { headers });
    await axios.put(`${server.uri}/playlists/${playlistId}/items`, null, {
      params: { uri },
      headers,
    });
    return playlistId;
  }

  const response = await axios.post(`${server.uri}/playlists`, null, {
    params: {
      type: "audio",
      title: name,
      smart: 0,
      uri,
    },
    headers,
  });

  return response.data?.MediaContainer?.Metadata?.[0]?.ratingKey || null;
}

export async function exportTracksToPlex({
  userId,
  name,
  trackIds,
  savedRuleId,
  rulesJson,
  optionsJson,
}: {
  userId: string;
  name: string;
  trackIds: string[];
  savedRuleId?: string | null;
  rulesJson?: string;
  optionsJson?: string;
}) {
  const tracks = await fetchOwnedTracksInOrder(userId, trackIds);
  const targetServer = assertSingleServer(tracks);
  const existingRule = savedRuleId
    ? await prisma.playlistRule.findFirst({ where: { id: savedRuleId, userId } })
    : null;

  if (savedRuleId && !existingRule) {
    throw new Error("Saved playlist was not found");
  }

  try {
    const playlistId = await pushTracksToPlex({
      server: targetServer,
      name,
      ratingKeys: tracks.map((track) => track.ratingKey || track.plexId),
      playlistId: existingRule?.plexPlaylistId,
    });

    if (existingRule) {
      await prisma.playlistRule.update({
        where: { id: existingRule.id },
        data: {
          name,
          serverId: targetServer.id,
          plexPlaylistId: playlistId,
          lastRefreshedAt: new Date(),
          lastRefreshStatus: "success",
          lastRefreshError: null,
        },
      });
    }

    await prisma.playlistHistory.create({
      data: {
        userId,
        playlistRuleId: existingRule?.id,
        serverId: targetServer.id,
        name,
        rulesJson: existingRule?.rulesJson || rulesJson || "[]",
        optionsJson: existingRule?.optionsJson || optionsJson || "{}",
        trackCount: tracks.length,
        plexPlaylistId: playlistId,
        status: "success",
      },
    });

    return {
      playlistId,
      serverId: targetServer.id,
      trackCount: tracks.length,
    };
  } catch (error: any) {
    await prisma.playlistHistory.create({
      data: {
        userId,
        playlistRuleId: existingRule?.id,
        serverId: targetServer.id,
        name,
        rulesJson: existingRule?.rulesJson || rulesJson || "[]",
        optionsJson: existingRule?.optionsJson || optionsJson || "{}",
        trackCount: tracks.length,
        plexPlaylistId: existingRule?.plexPlaylistId,
        status: "failed",
        error: error.message || "Failed to export playlist",
      },
    });
    throw error;
  }
}

export async function refreshSavedPlaylist(ruleId: string) {
  const rule = await prisma.playlistRule.findUnique({ where: { id: ruleId } });
  if (!rule || !rule.plexPlaylistId || !rule.serverId) return null;

  try {
    const savedRules = JSON.parse(rule.rulesJson);
    const parsed = playlistConfigSchema.parse({
      ...(Array.isArray(savedRules) ? { rules: savedRules } : { ruleTree: savedRules }),
      limit: rule.limit,
      serverId: rule.serverId,
      libraryId: rule.libraryId,
      ...JSON.parse(rule.optionsJson || "{}"),
    });
    const tracks = await generatePlaylistTracks({
      userId: rule.userId,
      config: parsed,
    });

    if (tracks.length === 0) {
      throw new Error("No tracks matched this saved playlist");
    }

    const targetServer = assertSingleServer(tracks);
    await pushTracksToPlex({
      server: targetServer,
      name: rule.name,
      ratingKeys: tracks.map((track) => track.ratingKey || track.plexId),
      playlistId: rule.plexPlaylistId,
    });

    await prisma.playlistHistory.create({
      data: {
        userId: rule.userId,
        playlistRuleId: rule.id,
        serverId: targetServer.id,
        name: rule.name,
        rulesJson: rule.rulesJson,
        optionsJson: rule.optionsJson,
        trackCount: tracks.length,
        plexPlaylistId: rule.plexPlaylistId,
        status: "success",
      },
    });

    return prisma.playlistRule.update({
      where: { id: rule.id },
      data: {
        lastRefreshedAt: new Date(),
        lastRefreshStatus: "success",
        lastRefreshError: null,
      },
    });
  } catch (error: any) {
    await prisma.playlistHistory.create({
      data: {
        userId: rule.userId,
        playlistRuleId: rule.id,
        serverId: rule.serverId,
        name: rule.name,
        rulesJson: rule.rulesJson,
        optionsJson: rule.optionsJson,
        trackCount: 0,
        plexPlaylistId: rule.plexPlaylistId,
        status: "failed",
        error: error.message || "Refresh failed",
      },
    });

    return prisma.playlistRule.update({
      where: { id: rule.id },
      data: {
        lastRefreshedAt: new Date(),
        lastRefreshStatus: "failed",
        lastRefreshError: error.message || "Refresh failed",
      },
    });
  }
}

export async function refreshAutoPlaylists() {
  const rules = await prisma.playlistRule.findMany({
    where: {
      autoRefresh: true,
      plexPlaylistId: { not: null },
      serverId: { not: null },
    },
    select: { id: true },
  });

  for (const rule of rules) {
    await refreshSavedPlaylist(rule.id);
  }

  return rules.length;
}
