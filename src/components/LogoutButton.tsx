"use client";

import { LogOut } from "lucide-react";
import axios from "axios";

export default function LogoutButton() {
  const handleLogout = async () => {
    try {
      await axios.post("/api/auth/logout");
      window.location.reload();
    } catch (e) {
      console.error("Failed to logout", e);
    }
  };

  return (
    <button 
      onClick={handleLogout}
      style={{
        background: "none",
        border: "none",
        color: "var(--text-muted)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0.25rem"
      }}
      title="Logout"
    >
      <LogOut size={16} />
    </button>
  );
}
