import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import axios from "axios";
import { getSpotifyPopularity } from "@/lib/providers/spotify";
import { getAudioDbFeatures } from "@/lib/providers/audiodb";
import { getLastFmPopularity } from "@/lib/providers/lastfm";
import { getDeezerPopularity } from "@/lib/providers/deezer";

export async function POST(req: Request) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ success: false, message: "Not logged in" }, { status: 401 });
  }

  try {
    const { provider } = await req.json();

    const artist = "Coldplay";
    const track = "Yellow";

    let success = false;
    let message = "";

    if (provider === "plex") {
      const server = await prisma.server.findFirst({ where: { userId } });
      if (!server) {
        return NextResponse.json({ success: false, message: "No Plex server connected" });
      }

      try {
        const response = await axios.get(`${server.uri}/identity`, {
          headers: { "Accept": "application/json" },
          timeout: 5000
        });
        success = response.status === 200;
        message = success ? `Success: Connected to ${server.name} (${response.data?.MediaContainer?.version || "Unknown Version"})` : "Failed to connect to Plex";
      } catch (e: any) {
        success = false;
        message = `Failed to connect to Plex: ${e.message}`;
      }

    } else if (provider === "spotify") {
      const score = await getSpotifyPopularity(artist, track);
      success = score !== null;
      message = success ? `Success: Fetched score ${score}` : "Failed to connect or authenticate.";
    } else if (provider === "audiodb") {
      const features = await getAudioDbFeatures(artist, track);
      success = features !== null;
      message = success ? `Success: Fetched features (Energy: ${features?.energy})` : "Failed to connect or track not found.";
    } else if (provider === "lastfm") {
      const score = await getLastFmPopularity(artist, track);
      success = score !== null;
      message = success ? `Success: Fetched score ${score}` : "Failed to connect or authenticate.";
    } else if (provider === "deezer") {
      const score = await getDeezerPopularity(artist, track);
      success = score !== null;
      message = success ? `Success: Fetched score ${score}` : "Failed to connect or authenticate.";
    } else {
      return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
    }

    return NextResponse.json({ success, message });
  } catch (error: any) {
    console.error(`Provider test failed:`, error.message);
    return NextResponse.json({ success: false, message: error.message || "Unknown error" }, { status: 500 });
  }
}
