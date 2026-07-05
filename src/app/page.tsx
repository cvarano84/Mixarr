import styles from "./page.module.css";
import { BrainCircuit, Fingerprint, Gauge, ListMusic, Radio, Repeat2, SlidersHorizontal, Wand2 } from "lucide-react";
import LibrarySelector from "@/components/LibrarySelector";
import SyncProgress from "@/components/SyncProgress";
import LibraryHealthPanel from "@/components/LibraryHealthPanel";
import PlexLoginButton from "@/components/PlexLoginButton";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

const previewFeatures = [
  {
    title: "Smart Mix Builder",
    description: "Build playlists from a vibe, mood, energy level, BPM range, genre blend, or listening goal.",
    examples: ["Late-night drive", "Gym mode", "Deep cuts only"],
    icon: SlidersHorizontal,
    badge: "Planned",
  },
  {
    title: "AI DJ Flow",
    description: "Create playlists with smooth pacing, energy curves, artist spacing, and better track-to-track flow.",
    examples: ["Warm-up to peak", "BPM-aware order", "Mood transitions"],
    icon: BrainCircuit,
    badge: "v2.0.0",
  },
  {
    title: "Infinite Radio Stations",
    description: "Generate living stations that keep refreshing based on your library, filters, and listening preferences.",
    examples: ["My Rock Radio", "Chill Night Station", "Discovery Radio"],
    icon: Radio,
    badge: "Concept",
  },
  {
    title: "Playlist Intelligence Score",
    description: "Preview playlist quality before saving with scoring for variety, flow, energy balance, and repeat risk.",
    examples: ["Flow score", "Genre spread", "Artist variety"],
    icon: Gauge,
    badge: "Preview",
  },
  {
    title: "Music DNA",
    description: "Visualize your library by energy, mood, BPM, genre, popularity, and audio feature coverage.",
    examples: ["Mood map", "BPM distribution", "Genre heatmap"],
    icon: Fingerprint,
    badge: "Planned",
  },
  {
    title: "Anti-Repeat Engine",
    description: "Prevent the same songs, artists, or albums from appearing too often.",
    examples: ["Track cooldown", "Artist cooldown", "Discovery boost"],
    icon: Repeat2,
    badge: "Concept",
  },
];

export default async function Home() {
  const cookieStore = cookies();
  const sessionId = cookieStore.get("mixarr_session")?.value;

  let user = null;
  if (sessionId) {
    user = await prisma.user.findUnique({
      where: { id: sessionId },
    });
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
          <LibraryHealthPanel />
          <section className={styles.comingSoonSection} aria-labelledby="coming-soon-v2">
            <div className={styles.comingSoonHeader}>
              <div>
                <span className={styles.kicker}>Preview</span>
                <h3 id="coming-soon-v2">Coming Soon in v2.0.0</h3>
                <p>Next-level playlist intelligence is coming to Mixarr.</p>
              </div>
              <span className={styles.versionPill}>v2.0.0</span>
            </div>
            <p className={styles.enrichmentNote}>
              Data enrichment controls have moved into their matching dashboard cards. Use the play button on each card to run or retry BPM, genres, popularity, or audio feature processing.
            </p>
            <div className={styles.previewGrid}>
              {previewFeatures.map((feature) => {
                const Icon = feature.icon;
                return (
                  <article key={feature.title} className={styles.previewCard}>
                    <div className={styles.previewCardTop}>
                      <span className={styles.previewIcon}><Icon size={18} /></span>
                      <span className={styles.previewBadge}>{feature.badge}</span>
                    </div>
                    <h4>{feature.title}</h4>
                    <p>{feature.description}</p>
                    <div className={styles.previewExamples}>
                      {feature.examples.map((example) => (
                        <span key={example}>{example}</span>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
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
