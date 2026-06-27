import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { APP_VERSION } from "@/lib/appVersion";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Mixarr",
  description: "Plex playlist curator",
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
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
      <body className={inter.variable}>

        {/* Animated Mesh Gradient Background */}
        <div className="mesh-bg">
          <div className="mesh-blob-1"></div>
          <div className="mesh-blob-2"></div>
        </div>

        <div className="app-container">
          <Sidebar user={user} appVersion={APP_VERSION} />
          <div className="main-content">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
