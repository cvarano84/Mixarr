import prisma from "./prisma";
import axios from "axios";
import { resolveLimit, type SyncEngineOptions } from "./syncSettings";

type PlexItem = Record<string, any> & {
  Genre?: Array<{ tag: string }>;
  ratingKey: string | number;
};

// Helper to fetch paginated items from Plex
const fetchPlexItems = async (serverUri: string, accessToken: string, libraryKey: string, typeId: number, pageSize?: number): Promise<PlexItem[]> => {
  let allItems: PlexItem[] = [];
  let start = 0;
  const size = pageSize;
  let totalSize = Infinity;

  if (!size) {
    const response = await axios.get(`${serverUri}/library/sections/${libraryKey}/all`, {
      params: { type: typeId },
      headers: {
        "Accept": "application/json",
        "X-Plex-Token": accessToken,
        "X-Plex-Client-Identifier": (process.env.PLEX_CLIENT_IDENTIFIER || "mixarr-default-client").trim()
      }
    });

    return (response.data.MediaContainer.Metadata || []) as PlexItem[];
  }

  while (start < totalSize) {
    const response = await axios.get(`${serverUri}/library/sections/${libraryKey}/all`, {
      params: {
        type: typeId,
        "X-Plex-Container-Start": start,
        "X-Plex-Container-Size": size,
      },
      headers: {
        "Accept": "application/json",
        "X-Plex-Token": accessToken,
        "X-Plex-Client-Identifier": (process.env.PLEX_CLIENT_IDENTIFIER || "mixarr-default-client").trim()
      }
    });

    const container = response.data.MediaContainer;
    totalSize = container.totalSize !== undefined ? container.totalSize : container.size; 
    
    if (container.Metadata) {
      allItems = allItems.concat(container.Metadata as PlexItem[]);
    }
    
    start += size;
    
    if (!container.size || container.size < size) break;
  }
  
  return allItems;
};

// Helper to process items sequentially to avoid database race conditions (e.g., connectOrCreate constraints)
async function processSequentially<T>(items: T[], processFn: (item: T) => Promise<void>) {
  for (const item of items) {
    await processFn(item);
  }
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
  const title = String(track.title || "");
  const album = String(track.parentTitle || "");
  const combined = `${title} ${album}`.toLowerCase();
  const contentRating = String(track.contentRating || track.rating || "").toLowerCase();

  return {
    contentRating: track.contentRating || null,
    normalizedTitle: normalizeTrackTitle(title),
    isExplicit: contentRating.includes("explicit"),
    isLive: /\b(live|concert|session|unplugged)\b/.test(combined),
    isRemaster: /\b(remaster|remastered|anniversary edition|deluxe edition)\b/.test(combined),
    isHoliday: /\b(christmas|holiday|xmas|santa|noel|hanukkah|halloween)\b/.test(combined),
    isIntroOutro: /\b(intro|outro|interlude|skit|prologue|epilogue)\b/.test(title.toLowerCase()),
  };
}

export const runSyncEngine = async (libraryId: string, options: SyncEngineOptions = {}) => {
  const syncLog = await prisma.syncLog.create({
    data: {
      libraryId,
      status: "in_progress",
    }
  });

  try {
    const library = await prisma.library.findUnique({
      where: { id: libraryId },
      include: { server: true }
    });

    if (!library) throw new Error("Library not found");

    const { server } = library;
    const plexPageSize = resolveLimit(options.plexPageSize, "PLEX_METADATA_PAGE_SIZE");

    console.log(`[SyncEngine] Starting sync for library: ${library.name}`);

    // 1. Fetch & Upsert Artists (type 8)
    const plexArtists = await fetchPlexItems(server.uri, server.accessToken, library.plexId, 8, plexPageSize);
    console.log(`[SyncEngine] Found ${plexArtists.length} artists`);

    await processSequentially(plexArtists, async (artist) => {
      // Handle tags
      const tagsToConnect = [];
      if (artist.Genre) {
        for (const g of artist.Genre) {
          tagsToConnect.push({
            where: { type_name: { type: "genre", name: g.tag } },
            create: { type: "genre", name: g.tag }
          });
        }
      }

      await prisma.artist.upsert({
        where: { libraryId_plexId: { libraryId, plexId: artist.ratingKey.toString() } },
        update: {
          title: artist.title,
          summary: artist.summary,
          thumb: artist.thumb,
          updatedAt: artist.updatedAt ? new Date(artist.updatedAt * 1000) : undefined,
          tags: {
            connectOrCreate: tagsToConnect
          }
        },
        create: {
          plexId: artist.ratingKey.toString(),
          libraryId,
          title: artist.title,
          summary: artist.summary,
          thumb: artist.thumb,
          addedAt: artist.addedAt ? new Date(artist.addedAt * 1000) : undefined,
          updatedAt: artist.updatedAt ? new Date(artist.updatedAt * 1000) : undefined,
          tags: {
            connectOrCreate: tagsToConnect
          }
        }
      });
    });

    // 2. Fetch & Upsert Albums (type 9)
    const plexAlbums = await fetchPlexItems(server.uri, server.accessToken, library.plexId, 9, plexPageSize);
    console.log(`[SyncEngine] Found ${plexAlbums.length} albums`);

    // We need artist internal IDs mapping
    const dbArtists = await prisma.artist.findMany({ where: { libraryId }, select: { id: true, plexId: true } });
    const artistMap = new Map(dbArtists.map(a => [a.plexId, a.id]));

    await processSequentially(plexAlbums, async (album) => {
      const artistId = artistMap.get(album.parentRatingKey?.toString());
      if (!artistId) return; // Skip if artist missing

      await prisma.album.upsert({
        where: { libraryId_plexId: { libraryId, plexId: album.ratingKey.toString() } },
        update: {
          title: album.title,
          summary: album.summary,
          thumb: album.thumb,
          year: album.year,
          updatedAt: album.updatedAt ? new Date(album.updatedAt * 1000) : undefined,
        },
        create: {
          plexId: album.ratingKey.toString(),
          libraryId,
          artistId,
          title: album.title,
          summary: album.summary,
          thumb: album.thumb,
          year: album.year,
          addedAt: album.addedAt ? new Date(album.addedAt * 1000) : undefined,
          updatedAt: album.updatedAt ? new Date(album.updatedAt * 1000) : undefined,
        }
      });
    });

    // 3. Fetch & Upsert Tracks (type 10)
    const plexTracks = await fetchPlexItems(server.uri, server.accessToken, library.plexId, 10, plexPageSize);
    console.log(`[SyncEngine] Found ${plexTracks.length} tracks`);

    const dbAlbums = await prisma.album.findMany({ where: { libraryId }, select: { id: true, plexId: true } });
    const albumMap = new Map(dbAlbums.map(a => [a.plexId, a.id]));

    await processSequentially(plexTracks, async (track) => {
      const artistId = artistMap.get(track.grandparentRatingKey?.toString());
      const albumId = albumMap.get(track.parentRatingKey?.toString());
      
      if (!artistId || !albumId) return;
      const trackFlags = deriveTrackFlags(track);

      await prisma.track.upsert({
        where: { libraryId_plexId: { libraryId, plexId: track.ratingKey.toString() } },
        update: {
          title: track.title,
          duration: track.duration,
          trackIndex: track.index,
          rating: track.rating,
          contentRating: trackFlags.contentRating,
          normalizedTitle: trackFlags.normalizedTitle,
          isExplicit: trackFlags.isExplicit,
          isLive: trackFlags.isLive,
          isRemaster: trackFlags.isRemaster,
          isHoliday: trackFlags.isHoliday,
          isIntroOutro: trackFlags.isIntroOutro,
          viewCount: track.viewCount || track.playCount || 0,
          lastViewedAt: track.lastViewedAt ? new Date(track.lastViewedAt * 1000) : undefined,
          updatedAt: track.updatedAt ? new Date(track.updatedAt * 1000) : undefined,
        },
        create: {
          plexId: track.ratingKey.toString(),
          ratingKey: track.ratingKey.toString(),
          libraryId,
          artistId,
          albumId,
          title: track.title,
          duration: track.duration,
          trackIndex: track.index,
          rating: track.rating,
          contentRating: trackFlags.contentRating,
          normalizedTitle: trackFlags.normalizedTitle,
          isExplicit: trackFlags.isExplicit,
          isLive: trackFlags.isLive,
          isRemaster: trackFlags.isRemaster,
          isHoliday: trackFlags.isHoliday,
          isIntroOutro: trackFlags.isIntroOutro,
          viewCount: track.viewCount || track.playCount || 0,
          lastViewedAt: track.lastViewedAt ? new Date(track.lastViewedAt * 1000) : undefined,
          addedAt: track.addedAt ? new Date(track.addedAt * 1000) : undefined,
          updatedAt: track.updatedAt ? new Date(track.updatedAt * 1000) : undefined,
        }
      });
    });

    console.log(`[SyncEngine] Completed sync for library: ${library.name}`);

    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: { status: "success", endedAt: new Date() }
    });

  } catch (error: any) {
    console.error(`[SyncEngine] Failed`, error);
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: { status: "failed", endedAt: new Date(), error: error.message }
    });
  }
};
