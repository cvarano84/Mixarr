import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import axios from "axios";

export async function POST(req: Request) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { name, trackIds } = await req.json();

    if (!name || !trackIds || !Array.isArray(trackIds) || trackIds.length === 0) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    // 1. Fetch tracks to get their Plex ratingKeys and identify the server
    const tracks = await prisma.track.findMany({
      where: { id: { in: trackIds } },
      include: { library: { include: { server: true } } }
    });

    if (tracks.length === 0) {
      return NextResponse.json({ error: "No valid tracks found" }, { status: 404 });
    }

    // Assume all tracks belong to the same server for this playlist
    // (Plex playlists cannot span multiple servers)
    const targetServer = tracks[0].library.server;
    
    // Check if the user actually owns this server
    if (targetServer.userId !== userId) {
      return NextResponse.json({ error: "Unauthorized server access" }, { status: 403 });
    }

    const ratingKeys = tracks.map(t => t.plexId).join(",");

    // 2. Construct the Plex Playlist URI payload
    const uriParam = `server://${targetServer.machineIdentifier}/com.plexapp.plugins.library/library/metadata/${ratingKeys}`;

    // 3. Send POST request to Plex API
    const response = await axios.post(`${targetServer.uri}/playlists`, null, {
      params: {
        type: "audio",
        title: name,
        smart: 0,
        uri: uriParam
      },
      headers: {
        "X-Plex-Token": targetServer.accessToken,
        "X-Plex-Client-Identifier": (process.env.PLEX_CLIENT_IDENTIFIER || "mixarr").trim()
      }
    });

    return NextResponse.json({ 
      success: true, 
      playlistId: response.data?.MediaContainer?.Metadata?.[0]?.ratingKey || null 
    });

  } catch (error: any) {
    console.error("Export to Plex failed:", error.response?.data || error.message);
    return NextResponse.json({ error: "Failed to export playlist to Plex" }, { status: 500 });
  }
}
