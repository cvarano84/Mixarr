import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

export const metadata: Metadata = {
  title: "Mixarr - Smart Playlist Engine",
  description: "Create highly customizable Plex music playlists",
  icons: {
    icon: '/icon.svg',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Mixarr',
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = cookies();
  const sessionId = cookieStore.get("mixarr_session")?.value;

  let user = null;
  if (sessionId) {
    user = await prisma.user.findUnique({
      where: { id: sessionId },
    });
  }

  return (
    <html lang="en">
      <body className={`${inter.variable} ${outfit.variable}`} style={{ fontFamily: "var(--font-inter), sans-serif" }}>

        {/* Animated Mesh Gradient Background */}
        <div className="mesh-bg">
          <div className="mesh-blob-1"></div>
          <div className="mesh-blob-2"></div>
        </div>

        <div className="app-container">
          <Sidebar user={user} />
          <div className="main-content">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
