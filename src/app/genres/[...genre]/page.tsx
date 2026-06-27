import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Disc3, ListMusic, Search, SlidersHorizontal, Star, Tag, Wand2 } from "lucide-react";
import prisma from "@/lib/prisma";
import BlockTrackButton from "@/components/BlockTrackButton";
import TrackPreviewButton from "@/components/TrackPreviewButton";
import { getEffectiveBpm } from "@/lib/bpm";
import { isArtistOrGroupTag, normalizeGenreName } from "@/lib/genreFilters";
import styles from "../../library/library.module.css";

const pageSize = 50;
const sortOptions = ["popular", "recent", "title", "artist", "year", "plays"] as const;
const traitOptions = ["all", "unplayed", "played", "rated", "live", "remaster", "explicit", "missingPopularity"] as const;

function asOption<T extends readonly string[]>(value: string | undefined, options: T, fallback: T[number]) {
  return options.includes(value as T[number]) ? value as T[number] : fallback;
}

function buildHref(genre: string, values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "" && value !== "all") {
      params.set(key, String(value));
    }
  });
  const query = params.toString();
  const path = `/genres/${encodeURIComponent(genre)}`;
  return query ? `${path}?${query}` : path;
}

function buildQueryHref(basePath: string, values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "" && value !== "all") {
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

function decodeGenreParam(parts: string[]) {
  return parts.map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  }).join("/");
}

export default async function GenreDetailPage({
  params,
  searchParams,
}: {
  params: { genre: string[] };
  searchParams: { page?: string; q?: string; sort?: string; trait?: string; minPopularity?: string };
}) {
  const cookieStore = cookies();
  const sessionId = cookieStore.get("mixarr_session")?.value;

  if (!sessionId) {
    redirect("/");
  }

  const genre = decodeGenreParam(params.genre).trim();
  if (!genre) notFound();

  const page = Math.max(1, Number(searchParams.page) || 1);
  const q = (searchParams.q || "").trim();
  const sort = asOption(searchParams.sort, sortOptions, "popular");
  const trait = asOption(searchParams.trait, traitOptions, "all");
  const minPopularity = searchParams.minPopularity ? Number(searchParams.minPopularity) : undefined;
  const skip = (page - 1) * pageSize;

  const userTrackScope: Prisma.TrackWhereInput = {
    syncStatus: "active",
    library: {
      server: {
        userId: sessionId,
      },
    },
  };

  const artistRows = await prisma.artist.findMany({
    where: { syncStatus: "active", library: { server: { userId: sessionId } } },
    select: { title: true },
  });
  const artistNames = new Set(artistRows.map((artist) => normalizeGenreName(artist.title)));
  if (isArtistOrGroupTag(genre, artistNames)) notFound();

  const genreCondition: Prisma.TrackWhereInput = {
    tags: {
      some: {
        type: "genre",
        name: { equals: genre, mode: "insensitive" },
      },
    },
  };
  const filters: Prisma.TrackWhereInput[] = [userTrackScope, genreCondition];

  if (q) {
    filters.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { artist: { title: { contains: q, mode: "insensitive" } } },
        { album: { title: { contains: q, mode: "insensitive" } } },
      ],
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

  const [tracks, totalTracks, artistCount, albumCount, genreRecord] = await Promise.all([
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
          take: 5,
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
    prisma.artist.count({ where: { tracks: { some: { AND: [userTrackScope, genreCondition] } } } }),
    prisma.album.count({ where: { tracks: { some: { AND: [userTrackScope, genreCondition] } } } }),
    prisma.tag.findFirst({
      where: {
        type: "genre",
        name: { equals: genre, mode: "insensitive" },
        tracks: { some: userTrackScope },
      },
    }),
  ]);

  if (!genreRecord) notFound();

  const totalPages = Math.max(1, Math.ceil(totalTracks / pageSize));
  const boundedPage = Math.min(page, totalPages);
  const pageTopPopularity = tracks.reduce((max, track) => Math.max(max, track.popularity?.score || 0), 0);
  const baseParams = {
    q,
    sort,
    trait,
    minPopularity: Number.isFinite(minPopularity) ? minPopularity : undefined,
  };

  return (
    <>
      <header className={styles.detailHero}>
        <div>
          <Link href="/genres" className={styles.textButton}>
            <ArrowLeft size={15} /> Genres
          </Link>
          <h2 style={{ fontSize: "2.25rem", margin: "1rem 0 0.5rem 0" }}>{genre}</h2>
          <p className={styles.muted}>Tracks tagged with this genre in your synced Plex library.</p>
        </div>
        <div className={styles.headerActions}>
          <Link href={buildQueryHref("/builder", { from: "genres", genre, q, sort, trait, minPopularity: Number.isFinite(minPopularity) ? minPopularity : undefined })} className={styles.secondaryButton}>
            <Wand2 size={16} /> Build From Genre
          </Link>
          <Link href={`/library?genre=${encodeURIComponent(genre)}`} className={styles.secondaryButton}>
            <ListMusic size={16} /> Open in Library
          </Link>
        </div>
      </header>

      <div className={styles.statGrid}>
        <div className={`glass-panel ${styles.statPanel}`}>
          <div className={styles.iconWrap}><Tag size={23} /></div>
          <div><h3>{totalTracks.toLocaleString()}</h3><p>Matching Tracks</p></div>
        </div>
        <div className={`glass-panel ${styles.statPanel}`}>
          <div className={`${styles.iconWrap} ${styles.yellow}`}><Star size={23} /></div>
          <div><h3>{pageTopPopularity ? pageTopPopularity.toFixed(0) : "-"}</h3><p>Page Top Pop</p></div>
        </div>
        <div className={`glass-panel ${styles.statPanel}`}>
          <div className={`${styles.iconWrap} ${styles.blue}`}><ListMusic size={23} /></div>
          <div><h3>{artistCount.toLocaleString()}</h3><p>Artists</p></div>
        </div>
        <div className={`glass-panel ${styles.statPanel}`}>
          <div className={styles.iconWrap}><Disc3 size={23} /></div>
          <div><h3>{albumCount.toLocaleString()}</h3><p>Albums</p></div>
        </div>
      </div>

      <form action={`/genres/${encodeURIComponent(genre)}`} className={`glass-panel ${styles.filtersPanel}`}>
        <div className={styles.filterGrid}>
          <label className={styles.field}>
            Search This Genre
            <input className={styles.input} name="q" defaultValue={q} placeholder="Track, artist, or album" />
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
          <div className={styles.filterActions}>
            <button type="submit" className={styles.primaryButton}>
              <Search size={15} /> Apply
            </button>
            <Link href={`/genres/${encodeURIComponent(genre)}`} className={styles.textButton}>Clear</Link>
          </div>
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
                    <th>Related Genres</th>
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
                            {displayTags.map((tag) => (
                              <Link key={tag.id} href={`/genres/${encodeURIComponent(tag.name)}`} className={styles.genreChip}>
                                {tag.name}
                              </Link>
                            ))}
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
                  href={buildHref(genre, { ...baseParams, page: Math.max(1, boundedPage - 1) })}
                  className={`${styles.secondaryButton} ${boundedPage === 1 ? styles.disabled : ""}`}
                >
                  Previous
                </Link>
                <Link
                  href={buildHref(genre, { ...baseParams, page: Math.min(totalPages, boundedPage + 1) })}
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
