import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Hash, ListMusic, Search, Tag, Tags } from "lucide-react";
import prisma from "@/lib/prisma";
import { isArtistOrGroupTag, normalizeGenreName } from "@/lib/genreFilters";
import styles from "../library/library.module.css";

const sortOptions = ["tracks", "name"] as const;

function asSort(value?: string) {
  return sortOptions.includes(value as any) ? value as typeof sortOptions[number] : "tracks";
}

function buildHref(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `/genres?${query}` : "/genres";
}

export default async function GenresPage({
  searchParams,
}: {
  searchParams: { q?: string; sort?: string; minTracks?: string };
}) {
  const cookieStore = cookies();
  const sessionId = cookieStore.get("mixarr_session")?.value;

  if (!sessionId) {
    redirect("/");
  }

  const q = (searchParams.q || "").trim();
  const sort = asSort(searchParams.sort);
  const minTracks = Math.max(1, Number(searchParams.minTracks) || 1);
  const userTrackScope: Prisma.TrackWhereInput = {
    syncStatus: "active",
    library: {
      server: {
        userId: sessionId,
      },
    },
  };

  const [rawGenreTags, artistRows, taggedTrackCount, totalTrackCount] = await Promise.all([
    prisma.tag.findMany({
      where: {
        type: "genre",
        tracks: { some: userTrackScope },
      },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            tracks: { where: userTrackScope },
          },
        },
      },
    }),
    prisma.artist.findMany({
      where: { syncStatus: "active", library: { server: { userId: sessionId } } },
      select: { title: true },
    }),
    prisma.track.count({ where: { AND: [userTrackScope, { tags: { some: { type: "genre" } } }] } }),
    prisma.track.count({ where: userTrackScope }),
  ]);

  const artistNames = new Set(artistRows.map((artist) => normalizeGenreName(artist.title)));
  const genres = rawGenreTags
    .filter((tag) => tag._count.tracks >= minTracks)
    .filter((tag) => !isArtistOrGroupTag(tag.name, artistNames))
    .filter((tag) => !q || tag.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => sort === "name"
      ? a.name.localeCompare(b.name)
      : b._count.tracks - a._count.tracks || a.name.localeCompare(b.name));

  const topGenre = genres[0];
  const untaggedTrackCount = Math.max(0, totalTrackCount - taggedTrackCount);

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <h2>Genres</h2>
          <p>Explore the track-level genre tags Mixarr has synced.</p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/library" className={styles.secondaryButton}>
            <ListMusic size={16} /> Library
          </Link>
        </div>
      </header>

      <div className={styles.statGrid}>
        <div className={`glass-panel ${styles.statPanel}`}>
          <div className={styles.iconWrap}><Tags size={23} /></div>
          <div><h3>{genres.length.toLocaleString()}</h3><p>Visible Genres</p></div>
        </div>
        <div className={`glass-panel ${styles.statPanel}`}>
          <div className={`${styles.iconWrap} ${styles.blue}`}><Tag size={23} /></div>
          <div><h3>{taggedTrackCount.toLocaleString()}</h3><p>Tagged Tracks</p></div>
        </div>
        <div className={`glass-panel ${styles.statPanel}`}>
          <div className={`${styles.iconWrap} ${styles.yellow}`}><Hash size={23} /></div>
          <div><h3>{topGenre ? topGenre._count.tracks.toLocaleString() : "0"}</h3><p>{topGenre ? `Top: ${topGenre.name}` : "Top Genre"}</p></div>
        </div>
        <div className={`glass-panel ${styles.statPanel}`}>
          <div className={styles.iconWrap}><ListMusic size={23} /></div>
          <div><h3>{untaggedTrackCount.toLocaleString()}</h3><p>Untagged Tracks</p></div>
        </div>
      </div>

      <form action="/genres" className={`glass-panel ${styles.filtersPanel}`}>
        <div className={styles.filterGrid}>
          <label className={styles.field}>
            Search Genres
            <input className={styles.input} name="q" defaultValue={q} placeholder="rock, synthpop, hip-hop" />
          </label>
          <label className={styles.field}>
            Sort
            <select className={styles.select} name="sort" defaultValue={sort}>
              <option value="tracks">Track count</option>
              <option value="name">Name</option>
            </select>
          </label>
          <label className={styles.field}>
            Min Tracks
            <input className={styles.input} type="number" min="1" name="minTracks" defaultValue={String(minTracks)} />
          </label>
          <div className={styles.filterActions}>
            <button type="submit" className={styles.primaryButton}>
              <Search size={15} /> Apply
            </button>
            <Link href="/genres" className={styles.textButton}>Clear</Link>
          </div>
        </div>
        <div className={styles.quickChips}>
          {[1, 5, 10, 25].map((count) => (
            <Link key={count} href={buildHref({ q, sort, minTracks: count })} className={styles.chip}>
              {count}+ tracks
            </Link>
          ))}
        </div>
      </form>

      {genres.length === 0 ? (
        <div className={`glass-panel ${styles.emptyState}`}>
          <div>
            <Tags size={28} />
            <p>No genres matched the current filters.</p>
          </div>
        </div>
      ) : (
        <div className={styles.genreGrid}>
          {genres.map((genre) => (
            <Link key={genre.id} href={`/genres/${encodeURIComponent(genre.name)}`} className={styles.genreCard}>
              <span className={styles.genreName}>{genre.name}</span>
              <span className={styles.genreMeta}>
                <span>{genre._count.tracks.toLocaleString()} tracks</span>
                <span>Open</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
