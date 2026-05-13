import prisma from "./prisma";
import axios from "axios";

// Helper to fetch paginated items from Plex
const fetchPlexItems = async (serverUri: string, accessToken: string, libraryKey: string, typeId: number) => {
  let allItems: any[] = [];
  let start = 0;
  const size = 1000;
  let totalSize = Infinity;

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
      allItems = allItems.concat(container.Metadata);
    }
    
    start += size;
    
    if (!container.size || container.size < size) break;
  }
  
  return allItems;
};

// Helper to process items sequentially to avoid database race conditions (e.g., connectOrCreate constraints)
async function processInChunks<T>(items: T[], chunkSize: number, processFn: (item: T) => Promise<void>) {
  for (const item of items) {
    await processFn(item);
  }
}

export const runSyncEngine = async (libraryId: string) => {
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

    console.log(`[SyncEngine] Starting sync for library: ${library.name}`);

    // 1. Fetch & Upsert Artists (type 8)
    const plexArtists = await fetchPlexItems(server.uri, server.accessToken, library.plexId, 8);
    console.log(`[SyncEngine] Found ${plexArtists.length} artists`);

    await processInChunks(plexArtists, 50, async (artist) => {
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
    const plexAlbums = await fetchPlexItems(server.uri, server.accessToken, library.plexId, 9);
    console.log(`[SyncEngine] Found ${plexAlbums.length} albums`);

    // We need artist internal IDs mapping
    const dbArtists = await prisma.artist.findMany({ where: { libraryId }, select: { id: true, plexId: true } });
    const artistMap = new Map(dbArtists.map(a => [a.plexId, a.id]));

    await processInChunks(plexAlbums, 50, async (album) => {
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
    const plexTracks = await fetchPlexItems(server.uri, server.accessToken, library.plexId, 10);
    console.log(`[SyncEngine] Found ${plexTracks.length} tracks`);

    const dbAlbums = await prisma.album.findMany({ where: { libraryId }, select: { id: true, plexId: true } });
    const albumMap = new Map(dbAlbums.map(a => [a.plexId, a.id]));

    await processInChunks(plexTracks, 50, async (track) => {
      const artistId = artistMap.get(track.grandparentRatingKey?.toString());
      const albumId = albumMap.get(track.parentRatingKey?.toString());
      
      if (!artistId || !albumId) return;

      await prisma.track.upsert({
        where: { libraryId_plexId: { libraryId, plexId: track.ratingKey.toString() } },
        update: {
          title: track.title,
          duration: track.duration,
          trackIndex: track.index,
          rating: track.rating,
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
