import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import axios from "axios";
import {
  getSpotifyPopularity,
  getSpotifyTrackTags,
  isSpotifyTagLookupEnabled,
} from "@/lib/providers/spotify";
import { getAudioDbFeatures } from "@/lib/providers/audiodb";
import { getLastFmPopularity, getLastFmTrackTags } from "@/lib/providers/lastfm";
import { getDeezerPopularity, getDeezerTrackTags } from "@/lib/providers/deezer";
import { getDiscogsTrackTags, isDiscogsTagLookupEnabled } from "@/lib/providers/discogs";
import { getMusicBrainzTrackTags } from "@/lib/providers/musicbrainz";

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
    } else if (provider === "discogs-tags") {
      if (!isDiscogsTagLookupEnabled()) {
        success = false;
        message = "Discogs tag lookup is disabled. Set DISCOGS_TAGS_ENABLED=1 with DISCOGS_CONSUMER_KEY and DISCOGS_CONSUMER_SECRET after confirming policy fit.";
      } else {
        const tags = await getDiscogsTrackTags(artist, track);
        success = tags.length > 0;
        message = success ? `Success: Fetched tags ${tags.slice(0, 5).join(", ")}` : "Failed to fetch Discogs tags.";
      }
    } else if (provider === "musicbrainz-tags") {
      const tags = await getMusicBrainzTrackTags(artist, track);
      success = tags.length > 0;
      message = success ? `Success: Fetched tags ${tags.slice(0, 5).join(", ")}` : "Failed to fetch MusicBrainz tags.";
    } else if (provider === "spotify-tags") {
      if (!isSpotifyTagLookupEnabled()) {
        success = false;
        message = "Spotify tag lookup is disabled. Set SPOTIFY_TAGS_ENABLED=1 with Spotify credentials after confirming policy fit.";
      } else {
        const tags = await getSpotifyTrackTags(artist, track);
        success = tags.length > 0;
        message = success ? `Success: Fetched tags ${tags.slice(0, 5).join(", ")}` : "Failed to fetch Spotify artist genres.";
      }
    } else if (provider === "lastfm-tags") {
      const tags = await getLastFmTrackTags(artist, track);
      success = tags.length > 0;
      message = success ? `Success: Fetched fallback tags ${tags.slice(0, 5).join(", ")}` : "Failed to fetch Last.fm tags.";
    } else if (provider === "deezer-tags") {
      const tags = await getDeezerTrackTags(artist, track);
      success = tags.length > 0;
      message = success ? `Success: Fetched genre tags ${tags.slice(0, 5).join(", ")}` : "Failed to fetch Deezer genre tags.";
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
