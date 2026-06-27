import styles from "./page.module.css";
import Link from "next/link";
import { HeartPulse, ListMusic, Wand2 } from "lucide-react";
import LibrarySelector from "@/components/LibrarySelector";
import SyncProgress from "@/components/SyncProgress";
import PlexLoginButton from "@/components/PlexLoginButton";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { getLibraryHealth } from "@/lib/libraryHealth";

export default async function Home() {
  const cookieStore = cookies();
  const sessionId = cookieStore.get("mixarr_session")?.value;

  let user = null;
  let health: Awaited<ReturnType<typeof getLibraryHealth>> = [];
  if (sessionId) {
    user = await prisma.user.findUnique({
      where: { id: sessionId },
    });
    if (user) health = await getLibraryHealth(user.id);
  }

  return (
    <>
      <header className={styles.header}>
        <h2>Dashboard</h2>
        <p>Library overview</p>
      </header>

      {user ? (
        <div style={{ marginBottom: "3rem" }}>
          <SyncProgress />
          {health.length > 0 && (() => {
            const active = health.reduce((sum, library) => sum + library.activeTracks, 0);
            const missing = health.reduce((sum, library) => sum + library.missingTracks, 0);
            const status = health.some((library) => library.status === "error") ? "Error" : health.some((library) => library.status === "warning") ? "Warning" : "Healthy";
            const latest = health.map((library) => library.lastFullSyncAt).filter(Boolean).sort().at(-1) || null;
            return <Link href="/settings/library-health" className={`glass-panel ${styles.healthWidget}`}>
              <HeartPulse size={22} />
              <div><strong>Library Health</strong><span>Active: {active.toLocaleString()} &middot; Missing: {missing.toLocaleString()} &middot; Last sync: {latest ? new Date(latest).toLocaleString() : "Never"}</span></div>
              <b data-status={status.toLowerCase()}>{status}</b>
            </Link>;
          })()}
          <div className={styles.sectionHeader}>
            <h3>Your Plex Servers</h3>
          </div>
          <LibrarySelector />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2rem", marginBottom: "3rem" }}>
          <div className="glass-panel" style={{ padding: "2rem", textAlign: "center", borderRadius: "var(--radius-lg)", width: "100%", maxWidth: "600px" }}>
            <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.5rem" }}>Mixarr</h3>
            <p style={{ color: "var(--text-secondary)", marginBottom: "2rem" }}>
              Sign in with Plex to import your library and start building curated playlists.
            </p>
            {/* @ts-ignore - The component is client-side but we render it here */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <PlexLoginButton />
            </div>
          </div>

          <div className={styles.cardsGrid} style={{ width: "100%" }}>
            <div className={styles.card}>
              <Wand2 size={24} className={styles.cardIcon} />
              <h3>Build Playlist</h3>
              <p>Create a playlist with rules</p>
            </div>

            <div className={styles.card}>
              <ListMusic size={24} className={styles.cardIcon} />
              <h3>Browse Library</h3>
              <p>Explore your collection</p>
            </div>

            <div className={styles.card}>
              <ListMusic size={24} className={styles.cardIcon} />
              <h3>My Playlists</h3>
              <p>0 playlists created</p>
            </div>
          </div>
        </div>
      )}

      <div className={styles.recentSection}>
        <div className={styles.sectionHeader}>
          <h3>Recent Playlists</h3>
          <a href="#" className={styles.viewAll}>View All &rarr;</a>
        </div>
        <div className={styles.recentGrid}>
          <div className={styles.recentCard}>
            <div className={styles.recentIcon}>
              <ListMusic size={20} />
            </div>
            <div>
              <h4>Create your first mix</h4>
              <p>Open the builder to get started</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
