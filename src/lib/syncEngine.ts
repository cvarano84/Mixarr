import axios from "axios";
import prisma from "./prisma";
import { resolveLimit, type SyncEngineOptions } from "./syncSettings";
import { syncRunsTotal, syncDurationSeconds } from "./metrics";
import {
  sanitizeOptionalMetadataString,
  sanitizeRequiredMetadataString,
} from "./metadataSanitizer";

type PlexItem = Record<string, any> & {
  Genre?: Array<{ tag: string }>;
  ratingKey: string | number;
};

type PlexFetchResult = {
  items: PlexItem[];
  expectedTotal: number;
};

export type ReconciliationSummary = {
  syncRunId: string;
  activeTracksSeen: number;
  markedMissing: number;
  restored: number;
  activeDashboardCount: number;
  hardDeleted: number;
};

function plexHeaders(accessToken: string) {
  return {
    Accept: "application/json",
    "X-Plex-Token": accessToken,
    "X-Plex-Client-Identifier": (process.env.PLEX_CLIENT_IDENTIFIER || "mixarr-default-client").trim(),
  };
}

function assertCompletePlexResult(items: PlexItem[], expectedTotal: number, label: string) {
  if (items.length !== expectedTotal) {
    throw new Error(`Incomplete Plex ${label} response: received ${items.length} of ${expectedTotal}`);
  }

  const identities = new Set(items.map((item) => String(item.ratingKey)));
  if (identities.size !== items.length) {
    throw new Error(`Incomplete Plex ${label} response: duplicate rating keys were returned`);
  }
}

// Fetches every declared page and throws on short, empty, duplicated, or changing snapshots.
// A thrown fetch never reaches reconciliation, which is the primary partial-sync safety gate.
export const fetchPlexItems = async (
  serverUri: string,
  accessToken: string,
  libraryKey: string,
  typeId: number,
  pageSize?: number,
): Promise<PlexFetchResult> => {
  const url = `${serverUri}/library/sections/${libraryKey}/all`;

  if (!pageSize) {
    const response = await axios.get(url, {
      params: { type: typeId },
      headers: plexHeaders(accessToken),
    });
    const container = response.data?.MediaContainer;
    if (!container) throw new Error("Plex returned an invalid metadata response");
    const items = (container.Metadata || []) as PlexItem[];
    const expectedTotal = Number(container.totalSize ?? container.size ?? items.length);
    assertCompletePlexResult(items, expectedTotal, `type ${typeId}`);
    return { items, expectedTotal };
  }

  const items: PlexItem[] = [];
  let expectedTotal: number | null = null;
  let start = 0;

  while (expectedTotal === null || start < expectedTotal) {
    const response = await axios.get(url, {
      params: {
        type: typeId,
        "X-Plex-Container-Start": start,
        "X-Plex-Container-Size": pageSize,
      },
      headers: plexHeaders(accessToken),
    });
    const container = response.data?.MediaContainer;
    if (!container) throw new Error("Plex returned an invalid paginated metadata response");

    const page = (container.Metadata || []) as PlexItem[];
    if (container.size !== undefined && Number(container.size) !== page.length) {
      throw new Error(`Incomplete Plex type ${typeId} response: page declared ${container.size} items but returned ${page.length}`);
    }
    if (container.totalSize === undefined && page.length >= pageSize) {
      throw new Error(`Plex omitted totalSize for a full type ${typeId} page; reconciliation skipped because more pages may exist`);
    }
    const declaredTotal = Number(container.totalSize ?? (start + page.length));
    if (expectedTotal === null) expectedTotal = declaredTotal;
    if (declaredTotal !== expectedTotal) {
      throw new Error(`Plex library changed during pagination (${expectedTotal} to ${declaredTotal}); reconciliation skipped`);
    }
    if (page.length === 0 && start < expectedTotal) {
      throw new Error(`Incomplete Plex type ${typeId} response: empty page at ${start} of ${expectedTotal}`);
    }

    items.push(...page);
    start += page.length;
  }

  const total = expectedTotal ?? 0;
  assertCompletePlexResult(items, total, `type ${typeId}`);
  return { items, expectedTotal: total };
};

async function processSequentially<T>(items: T[], processFn: (item: T) => Promise<void>) {
  for (const item of items) await processFn(item);
}

function normalizeTrackTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/\([^)]*(remaster|remastered|live|explicit|mono|stereo|deluxe|version)[^)]*\)/gi, "")
    .replace(/\[[^\]]*(remaster|remastered|live|explicit|mono|stereo|deluxe|version)[^\]]*\]/gi, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveTrackFlags(track: any) {
  const title = sanitizeRequiredMetadataString(track.title, { entity: "Track", entityId: track.ratingKey, field: "title" });
  const album = sanitizeRequiredMetadataString(track.parentTitle, { entity: "Track", entityId: track.ratingKey, field: "album" });
  const combined = `${title} ${album}`.toLowerCase();
  const sanitizedContentRating = sanitizeOptionalMetadataString(track.contentRating, { entity: "Track", entityId: track.ratingKey, field: "contentRating" });
  const contentRating = String(sanitizedContentRating || track.rating || "").toLowerCase();

  return {
    contentRating: sanitizedContentRating,
    normalizedTitle: normalizeTrackTitle(title),
    isExplicit: contentRating.includes("explicit"),
    isLive: /\b(live|concert|session|unplugged)\b/.test(combined),
    isRemaster: /\b(remaster|remastered|anniversary edition|deluxe edition)\b/.test(combined),
    isHoliday: /\b(christmas|holiday|xmas|santa|noel|hanukkah|halloween)\b/.test(combined),
    isIntroOutro: /\b(intro|outro|interlude|skit|prologue|epilogue)\b/.test(title.toLowerCase()),
  };
}

function plexMediaPath(track: any): string | null {
  const value = track.Media?.flatMap((media: any) => media.Part || []).find((part: any) => part.file)?.file;
  return sanitizeOptionalMetadataString(value, { entity: "Track", entityId: track.ratingKey, field: "mediaPath" });
}

function unseenThisRun(syncRunId: string) {
  return {
    OR: [
      { lastSeenSyncId: null },
      { lastSeenSyncId: { not: syncRunId } },
    ],
  };
}

export function seenSyncData(syncRunId: string, seenAt: Date, plexLibraryId: string) {
  return {
    plexLibraryId,
    syncStatus: "active",
    lastSeenAt: seenAt,
    lastSeenSyncId: syncRunId,
    missingSince: null,
    deletedAt: null,
  };
}

export async function reconcileCompletedLibrary(
  tx: any,
  {
    libraryId,
    syncRunId,
    seenAt,
    snapshotComplete,
  }: {
    libraryId: string;
    syncRunId: string;
    seenAt: Date;
    snapshotComplete: boolean;
  },
) {
  if (!snapshotComplete) {
    throw new Error("Plex snapshot did not complete; reconciliation skipped");
  }

  const missingTracks = await tx.track.updateMany({
    where: { libraryId, syncStatus: "active", ...unseenThisRun(syncRunId) },
    data: { syncStatus: "missing", missingSince: seenAt },
  });

  await tx.album.updateMany({
    where: { libraryId, syncStatus: "active", tracks: { none: { syncStatus: "active" } } },
    data: { syncStatus: "missing", missingSince: seenAt },
  });
  await tx.artist.updateMany({
    where: {
      libraryId,
      syncStatus: "active",
      albums: { none: { syncStatus: "active" } },
      tracks: { none: { syncStatus: "active" } },
    },
    data: { syncStatus: "missing", missingSince: seenAt },
  });

  const activeDashboardCount = await tx.track.count({ where: { libraryId, syncStatus: "active" } });
  return { markedMissing: missingTracks.count, hardDeleted: 0, activeDashboardCount };
}

export const runSyncEngine = async (
  libraryId: string,
  options: SyncEngineOptions = {},
): Promise<ReconciliationSummary | undefined> => {
  const endTimer = syncDurationSeconds.startTimer();
  let result: "success" | "failed" = "success";
  let summary: ReconciliationSummary | undefined;

  const syncLog = await prisma.syncLog.create({
    data: { libraryId, status: "in_progress" },
  });
  const syncRunId = syncLog.id;
  const seenAt = new Date();

  try {
    const library = await prisma.library.findUnique({
      where: { id: libraryId },
      include: { server: true },
    });
    if (!library) throw new Error("Library not found");

    const { server } = library;
    const plexPageSize = resolveLimit(options.plexPageSize, "PLEX_METADATA_PAGE_SIZE");
    const seenData = seenSyncData(syncRunId, seenAt, library.plexId);

    console.log(`[SyncEngine] Starting sync ${syncRunId} for library: ${library.name}`);

    const { items: plexArtists } = await fetchPlexItems(server.uri, server.accessToken, library.plexId, 8, plexPageSize);
    console.log(`[SyncEngine] Found ${plexArtists.length} artists`);
    const plexArtistIds = new Set(plexArtists.map((artist) => sanitizeRequiredMetadataString(artist.ratingKey)));

    await processSequentially(plexArtists, async (artist) => {
      const plexId = sanitizeRequiredMetadataString(artist.ratingKey, { entity: "Artist", entityId: artist.ratingKey, field: "plexId" });
      const title = sanitizeRequiredMetadataString(artist.title, { entity: "Artist", entityId: artist.ratingKey, field: "title" });
      const summary = sanitizeOptionalMetadataString(artist.summary, { entity: "Artist", entityId: artist.ratingKey, field: "summary" });
      const thumb = sanitizeOptionalMetadataString(artist.thumb, { entity: "Artist", entityId: artist.ratingKey, field: "thumb" });
      const tagsToConnect = (artist.Genre || []).map((genre) => sanitizeRequiredMetadataString(genre.tag, { entity: "Artist", entityId: artist.ratingKey, field: "genre" }))
        .filter(Boolean)
        .map((name) => ({
          where: { type_name: { type: "genre", name } },
          create: { type: "genre", name },
        }));
      await prisma.artist.upsert({
        where: { libraryId_plexId: { libraryId, plexId } },
        update: {
          title,
          summary,
          thumb,
          updatedAt: artist.updatedAt ? new Date(artist.updatedAt * 1000) : undefined,
          ...seenData,
          tags: { connectOrCreate: tagsToConnect },
        },
        create: {
          plexId,
          libraryId,
          title,
          summary,
          thumb,
          addedAt: artist.addedAt ? new Date(artist.addedAt * 1000) : undefined,
          updatedAt: artist.updatedAt ? new Date(artist.updatedAt * 1000) : undefined,
          ...seenData,
          tags: { connectOrCreate: tagsToConnect },
        },
      });
    });

    const dbArtists = await prisma.artist.findMany({ where: { libraryId }, select: { id: true, plexId: true } });
    const artistMap = new Map(dbArtists.map((artist) => [artist.plexId, artist.id]));

    const { items: plexAlbums } = await fetchPlexItems(server.uri, server.accessToken, library.plexId, 9, plexPageSize);
    console.log(`[SyncEngine] Found ${plexAlbums.length} albums`);
    const plexAlbumIds = new Set(plexAlbums.map((album) => sanitizeRequiredMetadataString(album.ratingKey)));

    await processSequentially(plexAlbums, async (album) => {
      const parentPlexId = sanitizeOptionalMetadataString(album.parentRatingKey, { entity: "Album", entityId: album.ratingKey, field: "artistPlexId" }) || "";
      const artistId = artistMap.get(parentPlexId);
      if (!artistId || !plexArtistIds.has(parentPlexId)) {
        throw new Error(`Album ${album.ratingKey} references artist ${parentPlexId || "unknown"} absent from this Plex snapshot`);
      }
      const plexId = sanitizeRequiredMetadataString(album.ratingKey, { entity: "Album", entityId: album.ratingKey, field: "plexId" });
      const title = sanitizeRequiredMetadataString(album.title, { entity: "Album", entityId: album.ratingKey, field: "title" });
      const albumSummary = sanitizeOptionalMetadataString(album.summary, { entity: "Album", entityId: album.ratingKey, field: "summary" });
      const thumb = sanitizeOptionalMetadataString(album.thumb, { entity: "Album", entityId: album.ratingKey, field: "thumb" });
      await prisma.album.upsert({
        where: { libraryId_plexId: { libraryId, plexId } },
        update: {
          artistId,
          title,
          summary: albumSummary,
          thumb,
          year: album.year,
          updatedAt: album.updatedAt ? new Date(album.updatedAt * 1000) : undefined,
          ...seenData,
        },
        create: {
          plexId,
          libraryId,
          artistId,
          title,
          summary: albumSummary,
          thumb,
          year: album.year,
          addedAt: album.addedAt ? new Date(album.addedAt * 1000) : undefined,
          updatedAt: album.updatedAt ? new Date(album.updatedAt * 1000) : undefined,
          ...seenData,
        },
      });
    });

    const dbAlbums = await prisma.album.findMany({ where: { libraryId }, select: { id: true, plexId: true } });
    const albumMap = new Map(dbAlbums.map((album) => [album.plexId, album.id]));
    const previouslyInactive = new Set((await prisma.track.findMany({
      where: { libraryId, syncStatus: { not: "active" } },
      select: { plexId: true },
    })).map((track) => track.plexId));

    const { items: plexTracks } = await fetchPlexItems(server.uri, server.accessToken, library.plexId, 10, plexPageSize);
    console.log(`[SyncEngine] Found ${plexTracks.length} tracks`);
    let restored = 0;

    await processSequentially(plexTracks, async (track) => {
      const artistPlexId = sanitizeOptionalMetadataString(track.grandparentRatingKey, { entity: "Track", entityId: track.ratingKey, field: "artistPlexId" }) || "";
      const albumPlexId = sanitizeOptionalMetadataString(track.parentRatingKey, { entity: "Track", entityId: track.ratingKey, field: "albumPlexId" }) || "";
      const artistId = artistMap.get(artistPlexId);
      const albumId = albumMap.get(albumPlexId);
      if (!artistId || !albumId || !plexArtistIds.has(artistPlexId) || !plexAlbumIds.has(albumPlexId)) {
        throw new Error(`Track ${track.ratingKey} has a parent absent from this Plex snapshot`);
      }
      const trackFlags = deriveTrackFlags(track);
      const plexId = sanitizeRequiredMetadataString(track.ratingKey, { entity: "Track", entityId: track.ratingKey, field: "plexId" });
      const title = sanitizeRequiredMetadataString(track.title, { entity: "Track", entityId: track.ratingKey, field: "title" });
      const plexGuid = sanitizeOptionalMetadataString(track.guid, { entity: "Track", entityId: track.ratingKey, field: "plexGuid" });
      await prisma.track.upsert({
        where: { libraryId_plexId: { libraryId, plexId } },
        update: {
          ratingKey: plexId,
          plexGuid,
          mediaPath: plexMediaPath(track),
          artistId,
          albumId,
          title,
          duration: track.duration,
          trackIndex: track.index,
          rating: track.rating,
          ...trackFlags,
          viewCount: track.viewCount || track.playCount || 0,
          lastViewedAt: track.lastViewedAt ? new Date(track.lastViewedAt * 1000) : undefined,
          updatedAt: track.updatedAt ? new Date(track.updatedAt * 1000) : undefined,
          ...seenData,
        },
        create: {
          plexId,
          ratingKey: plexId,
          plexGuid,
          mediaPath: plexMediaPath(track),
          libraryId,
          artistId,
          albumId,
          title,
          duration: track.duration,
          trackIndex: track.index,
          rating: track.rating,
          ...trackFlags,
          viewCount: track.viewCount || track.playCount || 0,
          lastViewedAt: track.lastViewedAt ? new Date(track.lastViewedAt * 1000) : undefined,
          addedAt: track.addedAt ? new Date(track.addedAt * 1000) : undefined,
          updatedAt: track.updatedAt ? new Date(track.updatedAt * 1000) : undefined,
          ...seenData,
        },
      });
      if (previouslyInactive.has(plexId)) restored += 1;
    });

    // This transaction is reached only after all three complete Plex snapshots were
    // fetched and every item was successfully upserted.
    const reconciliation = await prisma.$transaction(async (tx) => {
      const reconciled = await reconcileCompletedLibrary(tx, {
        libraryId,
        syncRunId,
        seenAt,
        snapshotComplete: true,
      });
      await tx.syncLog.update({
        where: { id: syncLog.id },
        data: {
          status: "success",
          endedAt: new Date(),
          reconciliationAt: new Date(),
          snapshotComplete: true,
          plexReportedTrackCount: plexTracks.length,
        },
      });
      return reconciled;
    });

    summary = {
      syncRunId,
      activeTracksSeen: plexTracks.length,
      markedMissing: reconciliation.markedMissing,
      restored,
      activeDashboardCount: reconciliation.activeDashboardCount,
      hardDeleted: reconciliation.hardDeleted,
    };

    console.log(`[SyncEngine] Reconciliation for ${library.name}:`);
    console.log(`[SyncEngine] Active tracks seen this run: ${summary.activeTracksSeen}`);
    console.log(`[SyncEngine] Marked missing: ${summary.markedMissing}`);
    console.log(`[SyncEngine] Previously missing restored: ${summary.restored}`);
    console.log(`[SyncEngine] Active dashboard count: ${summary.activeDashboardCount}`);
    if (summary.hardDeleted > 0) console.log(`[SyncEngine] Hard-deleted after grace period: ${summary.hardDeleted}`);

  } catch (error: any) {
    console.error(`[SyncEngine] Failed; reconciliation skipped`, error);
    result = "failed";
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: { status: "failed", endedAt: new Date(), error: error.message },
    });
  } finally {
    endTimer();
    syncRunsTotal.inc({ result });
  }

  return summary;
};
