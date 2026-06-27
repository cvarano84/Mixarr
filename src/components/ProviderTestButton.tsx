"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import axios from "axios";

export default function ProviderTestButton({ provider, title, description, badgeText, badgeColor }: { provider: string, title: string, description: string, badgeText: string, badgeColor: string }) {
  const [status, setStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const testConnection = async () => {
    setStatus("testing");
    setMessage("");
    try {
      const res = await axios.post("/api/settings/test-provider", { provider });
      if (res.data.success) {
        setStatus("success");
        setMessage(res.data.message);
      } else {
        setStatus("error");
        setMessage(res.data.message);
      }
    } catch (e: any) {
      setStatus("error");
      setMessage(e.response?.data?.message || e.message || "Request failed");
    }
  };

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "1rem" }}>
      <div>
        <h4 style={{ margin: "0 0 0.25rem 0", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {title}
          <span style={{ padding: "0.15rem 0.5rem", background: `rgba(255,255,255,0.05)`, border: `1px solid ${badgeColor}`, color: badgeColor, borderRadius: "var(--radius-full)", fontSize: "0.65rem", fontWeight: 600 }}>
            {badgeText}
          </span>
        </h4>
        <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.875rem", color: "var(--text-secondary)" }}>{description}</p>
        
        {message && (
          <div style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", color: status === "success" ? "#22c55e" : "#ef4444" }}>
            {status === "success" ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {message}
          </div>
        )}
      </div>

      <button 
        onClick={testConnection} 
        disabled={status === "testing"}
        style={{
          background: "var(--bg-surface-hover)",
          border: "1px solid var(--border-strong)",
          color: "var(--text-primary)",
          padding: "0.5rem 1rem",
          borderRadius: "var(--radius-md)",
          cursor: status === "testing" ? "not-allowed" : "pointer",
          fontSize: "0.75rem",
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          opacity: status === "testing" ? 0.7 : 1
        }}
      >
        {status === "testing" ? <><Loader2 size={14} className="spin" /> Testing...</> : "Test Connection"}
      </button>

      <style jsx>{`
        .spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
