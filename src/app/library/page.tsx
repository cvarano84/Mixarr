import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Disc3, Filter, Mic2, Music, Search, SlidersHorizontal, Star, Tag, Wand2 } from "lucide-react";
import prisma from "@/lib/prisma";
import BlockTrackButton from "@/components/BlockTrackButton";
import TrackPreviewButton from "@/components/TrackPreviewButton";
import { getEffectiveBpm } from "@/lib/bpm";
import { isArtistOrGroupTag, normalizeGenreName } from "@/lib/genreFilters";
import styles from "./library.module.css";

const pageSize = 50;
const sortOptions = ["popular", "recent", "title", "artist", "year", "plays"] as const;
const traitOptions = ["all", "unplayed", "played", "rated", "live", "remaster", "explicit", "missingPopularity"] as const;
const statusOptions = ["active", "missing", "deleted", "all"] as const;

function asOption<T extends readonly string[]>(value: string | undefined, options: T, fallback: T[number]) {
  return options.includes(value as T[number]) ? value as T[number] : fallback;
}

function buildHref(basePath: string, values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "" && (value !== "all" || key === "status")) {
      params.set(key, String(value));
    }
  });
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function formatDuration(duration?: number | null) {
  if (!duration) return "-";
  const totalSeconds = Math.round(duration / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: { page?: string; q?: string; query?: string; genre?: string; sort?: string; trait?: string; status?: string; minPopularity?: string };
}) {
  const cookieStore = cookies();
  const sessionId = cookieStore.get("mixarr_session")?.value;

  if (!sessionId) {
    redirect("/");
  }

  const page = Math.max(1, Number(searchParams.page) || 1);
  const searchQuery = (searchParams.q || searchParams.query || "").trim();
  const genre = (searchParams.genre || "").trim();
  const sort = asOption(searchParams.sort, sortOptions, "popular");
  const trait = asOption(searchParams.trait, traitOptions, "all");
  const status = asOption(searchParams.status, statusOptions, "active");
  const minPopularity = searchParams.minPopularity ? Number(searchParams.minPopularity) : undefined;
  const skip = (page - 1) * pageSize;

  const userTrackScope: Prisma.TrackWhereInput = {
    library: {
      server: {
        userId: sessionId,
      },
    },
  };

  const filters: Prisma.TrackWhereInput[] = [userTrackScope];
  if (status !== "all") filters.push({ syncStatus: status });
  const statusScope: Prisma.TrackWhereInput = {
    AND: [userTrackScope, ...(status === "all" ? [] : [{ syncStatus: status }])],
  };

  if (searchQuery) {
    filters.push({
      OR: [
        { title: { contains: searchQuery, mode: "insensitive" } },
        { artist: { title: { contains: searchQuery, mode: "insensitive" } } },
        { album: { title: { contains: searchQuery, mode: "insensitive" } } },
      ],
    });
  }

  if (genre) {
    filters.push({
      tags: {
        some: {
          type: "genre",
          name: { equals: genre, mode: "insensitive" },
        },
      },
    });
  }

  if (Number.isFinite(minPopularity)) {
    filters.push({ popularity: { score: { gte: minPopularity } } } as Prisma.TrackWhereInput);
  }

  if (trait === "unplayed") filters.push({ viewCount: 0 });
  if (trait === "played") filters.push({ viewCount: { gt: 0 } });
  if (trait === "rated") filters.push({ rating: { not: null } });
  if (trait === "live") filters.push({ isLive: true });
  if (trait === "remaster") filters.push({ isRemaster: true });
  if (trait === "explicit") filters.push({ isExplicit: true });
  if (trait === "missingPopularity") filters.push({ popularity: null });

  const whereClause: Prisma.TrackWhereInput = { AND: filters };
  const orderBy: Prisma.TrackOrderByWithRelationInput[] =
    sort === "recent" ? [{ addedAt: "desc" }, { title: "asc" }] :
    sort === "title" ? [{ title: "asc" }] :
    sort === "artist" ? [{ artist: { title: "asc" } }, { title: "asc" }] :
    sort === "year" ? [{ album: { year: "desc" } }, { title: "asc" }] :
    sort === "plays" ? [{ viewCount: "desc" }, { title: "asc" }] :
    [{ popularity: { score: "desc" } }, { addedAt: "desc" }];

  const [tracks, totalTracks, totalArtists, totalAlbums, artistRows, rawGenreTags, taggedTrackCount] = await Promise.all([
    prisma.track.findMany({
      where: whereClause,
      include: {
        artist: true,
        album: true,
        popularity: true,
        audioFeature: true,
        tags: {
          where: { type: "genre" },
          orderBy: { name: "asc" },
          take: 4,
        },
        blockedBy: {
          where: { userId: sessionId },
          select: { id: true },
        },
      },
      orderBy,
      skip,
      take: pageSize,
    }),
    prisma.track.count({ where: whereClause }),
    prisma.artist.count({ where: { ...(status === "all" ? {} : { syncStatus: status }), library: { server: { userId: sessionId } } } }),
    prisma.album.count({ where: { ...(status === "all" ? {} : { syncStatus: status }), library: { server: { userId: sessionId } } } }),
    prisma.artist.findMany({
      where: { ...(status === "all" ? {} : { syncStatus: status }), library: { server: { userId: sessionId } } },
      select: { title: true },
    }),
    prisma.tag.findMany({
      where: {
        type: "genre",
        tracks: { some: statusScope },
      },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            tracks: { where: statusScope },
          },
        },
      },
    }),
    prisma.track.count({ where: { AND: [statusScope, { tags: { some: { type: "genre" } } }] } }),
  ]);

  const artistNames = new Set(artistRows.map((artist) => normalizeGenreName(artist.title)));
  const genreOptions = rawGenreTags
    .filter((tag) => tag._count.tracks > 0 && !isArtistOrGroupTag(tag.name, artistNames))
    .sort((a, b) => b._count.tracks - a._count.tracks || a.name.localeCompare(b.name));

  const topGenres = genreOptions.slice(0, 10);
  const totalPages = Math.max(1, Math.ceil(totalTracks / pageSize));
  const boundedPage = Math.min(page, totalPages);
  const baseParams = {
    q: searchQuery,
    genre,
    sort,
    trait,
    status,
    minPopularity: Number.isFinite(minPopularity) ? minPopularity : undefined,
  };

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <h2>Library Explorer</h2>
          <p>Browse, sort, and slice your synced Plex tracks.</p>
        </div>
        <div className={styles.headerActions}>
          <Link href={buildHref("/builder", { from: "library", ...baseParams })} className={styles.secondaryButton}>
            <Wand2 size={16} /> Build From View
          </Link>
          <Link href="/genres" className={styles.primaryButton}>
            <Tag size={16} /> Genres
          </Link>
        </div>
      </header>

      <div className={styles.statGrid}>
        <div className={`glass-panel ${styles.statPanel}`}>
          <div className={styles.iconWrap}><Music size={23} /></div>
          <div><h3>{totalTracks.toLocaleString()}</h3><p>Matching Tracks</p></div>
        </div>
        <div className={`glass-panel ${styles.statPanel}`}>
          <div className={`${styles.iconWrap} ${styles.yellow}`}><Mic2 size={23} /></div>
          <div><h3>{totalArtists.toLocaleString()}</h3><p>Total Artists</p></div>
        </div>
        <div className={`glass-panel ${styles.statPanel}`}>
          <div className={`${styles.iconWrap} ${styles.blue}`}><Disc3 size={23} /></div>
          <div><h3>{totalAlbums.toLocaleString()}</h3><p>Total Albums</p></div>
        </div>
        <div className={`glass-panel ${styles.statPanel}`}>
          <div className={styles.iconWrap}><Tag size={23} /></div>
          <div><h3>{taggedTrackCount.toLocaleString()}</h3><p>Tagged Tracks</p></div>
        </div>
      </div>

      <form action="/library" className={`glass-panel ${styles.filtersPanel}`}>
        <div className={styles.filterGrid}>
          <label className={styles.field}>
            Search
            <input className={styles.input} name="q" defaultValue={searchQuery} placeholder="Track, artist, or album" />
          </label>
          <label className={styles.field}>
            Genre
            <select className={styles.select} name="genre" defaultValue={genre}>
              <option value="">All genres</option>
              {genre && !genreOptions.some((tag) => tag.name === genre) && <option value={genre}>{genre}</option>}
              {genreOptions.slice(0, 200).map((tag) => (
                <option key={tag.id} value={tag.name}>{tag.name} ({tag._count.tracks})</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Sort
            <select className={styles.select} name="sort" defaultValue={sort}>
              <option value="popular">Most popular</option>
              <option value="recent">Recently added</option>
              <option value="title">Track title</option>
              <option value="artist">Artist name</option>
              <option value="year">Release year</option>
              <option value="plays">Most played</option>
            </select>
          </label>
          <label className={styles.field}>
            Trait
            <select className={styles.select} name="trait" defaultValue={trait}>
              <option value="all">Any track</option>
              <option value="unplayed">Unplayed</option>
              <option value="played">Played</option>
              <option value="rated">Rated</option>
              <option value="live">Live</option>
              <option value="remaster">Remasters</option>
              <option value="explicit">Explicit</option>
              <option value="missingPopularity">No popularity score</option>
            </select>
          </label>
          <label className={styles.field}>
            Min Popularity
            <input className={styles.input} type="number" name="minPopularity" min="0" max="100" defaultValue={Number.isFinite(minPopularity) ? String(minPopularity) : ""} placeholder="0-100" />
          </label>
          <label className={styles.field}>
            Sync Status
            <select className={styles.select} name="status" defaultValue={status}>
              <option value="active">Active</option>
              <option value="missing">Missing from Plex</option>
              <option value="deleted">Deleted</option>
              <option value="all">All statuses</option>
            </select>
          </label>
        </div>
        <div className={styles.quickChips}>
          <button className={styles.secondaryButton} type="submit">
            <Search size={15} /> Apply
          </button>
          <Link href="/library" className={styles.textButton}>
            <Filter size={15} /> Clear
          </Link>
          {topGenres.map((tag) => (
            <Link
              key={tag.id}
              href={buildHref("/library", { ...baseParams, genre: tag.name, page: 1 })}
              className={styles.genreChip}
            >
              <Tag size={13} /> {tag.name}
            </Link>
          ))}
        </div>
      </form>

      <div className={styles.tableShell}>
        {tracks.length === 0 ? (
          <div className={styles.emptyState}>
            <div>
              <SlidersHorizontal size={28} />
              <p>No tracks matched the current filters.</p>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.tableScroller}>
              <table className={styles.trackTable}>
                <thead>
                  <tr>
                    <th>Track</th>
                    <th>Artist</th>
                    <th className={styles.hideMobile}>Album</th>
                    <th>Genres</th>
                    <th className={styles.hideMobile}>Stats</th>
                    <th className={styles.nowrap}>Popularity</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tracks.map((track) => {
                    const displayTags = track.tags.filter((tag) => !isArtistOrGroupTag(tag.name, artistNames));
                    const effectiveBpm = getEffectiveBpm(track);
                    return (
                      <tr key={track.id}>
                        <td className={styles.titleCell}>
                          <div className={styles.trackTitle}>{track.title}</div>
                          <div className={styles.subtle}>{formatDuration(track.duration)}</div>
                          {track.syncStatus !== "active" && (
                            <div className={styles.badges}>
                              <span className={styles.badge}>{track.syncStatus}</span>
                              {track.missingSince && <span className={styles.subtle}>since {track.missingSince.toLocaleDateString()}</span>}
                            </div>
                          )}
                          {(track.isLive || track.isRemaster || track.isExplicit) && (
                            <div className={styles.badges}>
                              {track.isLive && <span className={styles.badge}>Live</span>}
                              {track.isRemaster && <span className={styles.badge}>Remaster</span>}
                              {track.isExplicit && <span className={styles.badge}>Explicit</span>}
                            </div>
                          )}
                        </td>
                        <td className={styles.muted}>{track.artist.title}</td>
                        <td className={`${styles.muted} ${styles.hideMobile}`}>
                          <div className={styles.stacked}>
                            <span>{track.album.title}</span>
                            {track.album.year && <span className={styles.subtle}>{track.album.year}</span>}
                          </div>
                        </td>
                        <td>
                          <div className={styles.genreList}>
                            {displayTags.length > 0 ? displayTags.map((tag) => (
                              <Link key={tag.id} href={`/genres/${encodeURIComponent(tag.name)}`} className={styles.genreChip}>
                                {tag.name}
                              </Link>
                            )) : <span className={styles.subtle}>Untagged</span>}
                          </div>
                        </td>
                        <td className={`${styles.muted} ${styles.hideMobile}`}>
                          <div className={styles.stacked}>
                            <span>{track.viewCount.toLocaleString()} plays</span>
                            <span className={styles.subtle}>
                              {effectiveBpm ? `${effectiveBpm.toFixed(0)} BPM` : "No BPM"}
                              {track.rating ? ` / ${track.rating.toFixed(1)} rating` : ""}
                            </span>
                          </div>
                        </td>
                        <td>
                          {track.popularity ? (
                            <span className={styles.popCell}>
                              <Star size={16} fill={track.popularity.score > 80 ? "currentColor" : "none"} />
                              {track.popularity.score.toFixed(0)}
                            </span>
                        ) : (
                          <span className={styles.subtle}>N/A</span>
                        )}
                      </td>
                      <td>
                        <div className={styles.trackActions}>
                          <TrackPreviewButton trackId={track.id} />
                          <BlockTrackButton trackId={track.id} initialBlocked={track.blockedBy.length > 0} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                </tbody>
              </table>
            </div>
            <div className={styles.pager}>
              <span className={styles.subtle}>
                Showing {(skip + 1).toLocaleString()}-{Math.min(skip + tracks.length, totalTracks).toLocaleString()} of {totalTracks.toLocaleString()} tracks
              </span>
              <div className={styles.pagerControls}>
                <Link
                  href={buildHref("/library", { ...baseParams, page: Math.max(1, boundedPage - 1) })}
                  className={`${styles.secondaryButton} ${boundedPage === 1 ? styles.disabled : ""}`}
                >
                  Previous
                </Link>
                <Link
                  href={buildHref("/library", { ...baseParams, page: Math.min(totalPages, boundedPage + 1) })}
                  className={`${styles.secondaryButton} ${boundedPage === totalPages ? styles.disabled : ""}`}
                >
                  Next
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
