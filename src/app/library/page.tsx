import { Music, Disc3, Mic2, Star } from "lucide-react";
import prisma from "@/lib/prisma";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: { page?: string, query?: string }
}) {
  const cookieStore = cookies();
  const sessionId = cookieStore.get("mixarr_session")?.value;
  
  if (!sessionId) {
    redirect("/");
  }

  const page = Number(searchParams.page) || 1;
  const pageSize = 50;
  const skip = (page - 1) * pageSize;
  const searchQuery = searchParams.query || "";

  const whereClause = searchQuery ? {
    title: { contains: searchQuery, mode: "insensitive" as const }
  } : {};

  // Fetch tracks with their popularity and artist data
  const tracks = await prisma.track.findMany({
    where: whereClause,
    include: {
      artist: true,
      album: true,
      popularity: true,
    },
    orderBy: [
      { popularity: { score: 'desc' } }, // Sort by most popular first by default
      { addedAt: 'desc' }
    ],
    skip,
    take: pageSize,
  });

  const [totalTracks, totalArtists, totalAlbums] = await Promise.all([
    prisma.track.count({ where: whereClause }),
    prisma.artist.count(),
    prisma.album.count()
  ]);
  const totalPages = Math.ceil(totalTracks / pageSize);

  return (
    <>
      <header style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "2rem", fontWeight: 700, margin: "0 0 0.5rem 0" }}>Library Explorer</h2>
        <p style={{ color: "var(--text-secondary)", margin: 0 }}>Browse your synced Plex metadata</p>
      </header>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1.5rem", marginBottom: "2rem" }}>
        <div className="glass-panel" style={{ padding: "1.5rem", borderRadius: "var(--radius-md)", display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={{ background: "rgba(139, 92, 246, 0.1)", padding: "0.75rem", borderRadius: "var(--radius-sm)", color: "var(--accent-primary)" }}><Music size={24} /></div>
          <div><h3 style={{ margin: 0, fontSize: "1.5rem" }}>{totalTracks.toLocaleString()}</h3><p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.875rem" }}>Total Tracks</p></div>
        </div>

        <div className="glass-panel" style={{ padding: "1.5rem", borderRadius: "var(--radius-md)", display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={{ background: "rgba(234, 179, 8, 0.1)", padding: "0.75rem", borderRadius: "var(--radius-sm)", color: "var(--accent-yellow)" }}><Mic2 size={24} /></div>
          <div><h3 style={{ margin: 0, fontSize: "1.5rem" }}>{totalArtists.toLocaleString()}</h3><p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.875rem" }}>Total Artists</p></div>
        </div>

        <div className="glass-panel" style={{ padding: "1.5rem", borderRadius: "var(--radius-md)", display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={{ background: "rgba(59, 130, 246, 0.1)", padding: "0.75rem", borderRadius: "var(--radius-sm)", color: "var(--accent-blue)" }}><Disc3 size={24} /></div>
          <div><h3 style={{ margin: 0, fontSize: "1.5rem" }}>{totalAlbums.toLocaleString()}</h3><p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.875rem" }}>Total Albums</p></div>
        </div>
      </div>

      <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border-subtle)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-subtle)", backgroundColor: "var(--bg-base)" }}>
              <th style={{ padding: "1rem", color: "var(--text-secondary)", fontWeight: 600, fontSize: "0.875rem" }}>Track</th>
              <th style={{ padding: "1rem", color: "var(--text-secondary)", fontWeight: 600, fontSize: "0.875rem" }}>Artist</th>
              <th style={{ padding: "1rem", color: "var(--text-secondary)", fontWeight: 600, fontSize: "0.875rem" }}>Album</th>
              <th style={{ padding: "1rem", color: "var(--text-secondary)", fontWeight: 600, fontSize: "0.875rem" }}>Popularity</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((track) => (
              <tr key={track.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td style={{ padding: "1rem", fontWeight: 500 }}>{track.title}</td>
                <td style={{ padding: "1rem", color: "var(--text-secondary)" }}>{track.artist.title}</td>
                <td style={{ padding: "1rem", color: "var(--text-secondary)" }}>{track.album.title}</td>
                <td style={{ padding: "1rem" }}>
                  {track.popularity ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <Star size={16} color={track.popularity.score > 80 ? "var(--accent-yellow)" : "var(--text-muted)"} fill={track.popularity.score > 80 ? "var(--accent-yellow)" : "none"} />
                      <span style={{ fontWeight: 600 }}>{track.popularity.score.toFixed(0)}</span>
                    </div>
                  ) : (
                    <span style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>N/A</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination Controls */}
        <div style={{ padding: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "var(--bg-base)", borderTop: "1px solid var(--border-subtle)" }}>
          <span style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>Page {page} of {totalPages}</span>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <a href={`/library?page=${Math.max(1, page - 1)}`} style={{ padding: "0.5rem 1rem", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", color: page === 1 ? "var(--text-muted)" : "var(--text-primary)", pointerEvents: page === 1 ? "none" : "auto", textDecoration: "none", fontSize: "0.875rem" }}>Previous</a>
            <a href={`/library?page=${Math.min(totalPages, page + 1)}`} style={{ padding: "0.5rem 1rem", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", color: page === totalPages ? "var(--text-muted)" : "var(--text-primary)", pointerEvents: page === totalPages ? "none" : "auto", textDecoration: "none", fontSize: "0.875rem" }}>Next</a>
          </div>
        </div>
      </div>
    </>
  );
}
