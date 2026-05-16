import { Settings as SettingsIcon, Database, Key, Server, RefreshCw } from "lucide-react";
import ProviderTestButton from "@/components/ProviderTestButton";
import LibraryDefaultSelector from "@/components/LibraryDefaultSelector";

export default function SettingsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem", height: "100%", maxWidth: "800px", margin: "0 auto" }}>
      <header>
        <h2 style={{ fontSize: "2rem", fontWeight: 700, margin: "0 0 0.5rem 0", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <SettingsIcon size={32} color="var(--accent-primary)" /> Settings
        </h2>
        <p style={{ color: "var(--text-secondary)", margin: 0 }}>Manage your application configuration and connections.</p>
      </header>

      {/* API Keys & Integrations */}
      <section className="glass-panel" style={{ padding: "1.5rem", borderRadius: "var(--radius-lg)" }}>
        <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Key size={20} color="var(--accent-blue)" /> External APIs
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <ProviderTestButton 
            provider="spotify"
            title="Spotify Audio Features"
            description="Used for high-precision energy and valence analysis."
            badgeText="Configured via .env"
            badgeColor="#22c55e"
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
            title="Last.fm Popularity & Tags"
            description="Used for global trending scores AND track genre/tag enrichment. Last.fm is currently the only configured tag source - the Track Genres engine will return 0 results without a LASTFM_API_KEY."
            badgeText="Configured via .env"
            badgeColor="#22c55e"
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
      <section className="glass-panel" style={{ padding: "1.5rem", borderRadius: "var(--radius-lg)" }}>
        <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Server size={20} color="var(--accent-yellow)" /> Plex Identity
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <ProviderTestButton 
            provider="plex"
            title="Local Plex Server"
            description="The current active Plex Media Server that hosts your library."
            badgeText="OAuth Linked"
            badgeColor="#eab308"
          />
          <div>
            <label style={{ display: "block", fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Client Identifier</label>
            <input type="text" readOnly value={process.env.PLEX_CLIENT_IDENTIFIER || "Not Set"} style={inputStyle} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Product Name</label>
            <input type="text" readOnly value={process.env.PLEX_PRODUCT_NAME || "Mixarr"} style={inputStyle} />
          </div>
          <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "1rem" }}>
            <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "1rem" }}>Default Playlist Source</h4>
            <LibraryDefaultSelector />
          </div>
        </div>
      </section>

      {/* Database Management */}
      <section className="glass-panel" style={{ padding: "1.5rem", borderRadius: "var(--radius-lg)", border: "1px solid rgba(239, 68, 68, 0.2)" }}>
        <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem", color: "#ef4444" }}>
          <Database size={20} /> Data Management
        </h3>
        <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
          These actions are performed automatically by the background engines, but you can manually trigger them or completely reset your cache if needed.
        </p>
        
        <div style={{ display: "flex", gap: "1rem" }}>
          <button style={dangerBtnStyle}>
            Reset Database Cache
          </button>
        </div>
      </section>

    </div>
  );
}

const inputStyle = {
  background: "rgba(0,0,0,0.2)",
  border: "1px solid var(--border-subtle)",
  color: "var(--text-primary)",
  padding: "0.75rem",
  borderRadius: "var(--radius-sm)",
  fontSize: "0.875rem",
  width: "100%",
  outline: "none",
  cursor: "not-allowed"
};

const dangerBtnStyle = {
  background: "rgba(239, 68, 68, 0.1)",
  border: "1px solid rgba(239, 68, 68, 0.3)",
  color: "#ef4444",
  padding: "0.75rem 1.5rem",
  borderRadius: "var(--radius-md)",
  cursor: "not-allowed",
  fontSize: "0.875rem",
  fontWeight: 600,
  opacity: 0.7
};
