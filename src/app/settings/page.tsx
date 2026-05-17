import { Settings as SettingsIcon, Database, Key, Server, RefreshCw } from "lucide-react";
import ProviderTestButton from "@/components/ProviderTestButton";
import LibraryDefaultSelector from "@/components/LibraryDefaultSelector";
import SyncOptionsForm from "@/components/SyncOptionsForm";
import styles from "./settings.module.css";

export default function SettingsPage() {
  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <h2>
          <SettingsIcon size={28} color="var(--accent)" /> Settings
        </h2>
        <p>Manage your configuration and connections.</p>
      </header>

      {/* API Keys & Integrations */}
      <section className={`glass-panel ${styles.section}`}>
        <h3 className={styles.sectionTitle}>
          <Key size={20} color="var(--info)" /> External APIs
        </h3>
        <div className={styles.providerList}>
          <ProviderTestButton 
            provider="spotify"
            title="Spotify Audio Features"
            description="Used for high-precision energy and valence analysis."
            badgeText="Configured via .env"
            badgeColor="#22c55e"
          />

          <ProviderTestButton
            provider="deezer-tags"
            title="Deezer Genre Tags"
            description="Primary track-tag seed from matched Deezer album genres."
            badgeText="Active (Free Tier)"
            badgeColor="#22c55e"
          />

          <ProviderTestButton
            provider="discogs-tags"
            title="Discogs Genre Tags"
            description="Opt-in source for release genre and style tags using Discogs Consumer Key and Secret."
            badgeText="Opt-in"
            badgeColor="#eab308"
          />

          <ProviderTestButton
            provider="musicbrainz-tags"
            title="MusicBrainz Genre Tags"
            description="Free genre and tag lookup with a required User-Agent and conservative rate limit."
            badgeText="No API key"
            badgeColor="#22c55e"
          />

          <ProviderTestButton
            provider="spotify-tags"
            title="Spotify Artist Genres"
            description="Optional artist-genre source; enable only after confirming your Spotify policy fit."
            badgeText="Opt-in"
            badgeColor="#eab308"
          />
          
          <ProviderTestButton 
            provider="audiodb"
            title="AudioDB Fallback"
            description="Primary source for mood tag analysis and metadata fallback."
            badgeText="Active (Free Tier)"
            badgeColor="#22c55e"
          />

          <ProviderTestButton 
            provider="lastfm"
            title="Last.fm Popularity"
            description="Used for global trending scores and ranking algorithms."
            badgeText="Configured via .env"
            badgeColor="#22c55e"
          />

          <ProviderTestButton
            provider="lastfm-tags"
            title="Last.fm Tag Fallback"
            description="Final genre-tag fallback after Deezer, Discogs, MusicBrainz, and optional Spotify do not return tags."
            badgeText="Fallback only"
            badgeColor="#eab308"
          />

          <ProviderTestButton 
            provider="deezer"
            title="Deezer Popularity"
            description="Secondary source for global trending scores."
            badgeText="Active (Free Tier)"
            badgeColor="#22c55e"
          />
        </div>
      </section>

      {/* Plex Connection */}
      <section className={`glass-panel ${styles.section}`}>
        <h3 className={styles.sectionTitle}>
          <Server size={20} color="var(--warning)" /> Plex Identity
        </h3>
        <div className={styles.providerList}>
          <ProviderTestButton 
            provider="plex"
            title="Local Plex Server"
            description="The current active Plex Media Server that hosts your library."
            badgeText="OAuth Linked"
            badgeColor="#eab308"
          />
          <div className={styles.field}>
            <label>Client Identifier</label>
            <input type="text" readOnly value={process.env.PLEX_CLIENT_IDENTIFIER || "Not Set"} className={styles.readonlyInput} />
          </div>
          <div className={styles.field}>
            <label>Product Name</label>
            <input type="text" readOnly value={process.env.PLEX_PRODUCT_NAME || "Mixarr"} className={styles.readonlyInput} />
          </div>
          <div className={styles.divider}>
            <h4>Default Playlist Source</h4>
            <LibraryDefaultSelector />
          </div>
        </div>
      </section>

      {/* Sync Controls */}
      <section className={`glass-panel ${styles.section}`}>
        <h3 className={styles.sectionTitle}>
          <RefreshCw size={20} color="var(--accent)" /> Sync Controls
        </h3>
        <p className={styles.sectionDesc}>
          Tune how much metadata each manual sync run processes. Leave a field empty to remove that batch cap.
        </p>
        <SyncOptionsForm />
      </section>

      {/* Database Management */}
      <section className={styles.dangerSection}>
        <h3>
          <Database size={20} /> Data Management
        </h3>
        <p className={styles.sectionDesc}>
          These actions are performed automatically by the background engines, but you can manually trigger them or completely reset your cache if needed.
        </p>
        <div className={styles.dangerActions}>
          <button className={styles.dangerBtn}>
            Reset Database Cache
          </button>
        </div>
      </section>
    </div>
  );
}
