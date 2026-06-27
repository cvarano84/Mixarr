import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

function plexClientIdentifier() {
  return (process.env.PLEX_CLIENT_IDENTIFIER || "mixarr").trim();
}

function plexHeaders(accessToken: string, range?: string | null, accept = "application/json") {
  return {
    Accept: accept,
    "X-Plex-Token": accessToken,
    "X-Plex-Client-Identifier": plexClientIdentifier(),
    ...(range ? { Range: range } : {}),
  };
}

function copyHeader(source: Headers, target: Headers, name: string) {
  const value = source.get(name);
  if (value) target.set(name, value);
}

async function proxyPlexAudio(url: URL, accessToken: string, range: string | null) {
  const streamResponse = await fetch(url, {
    headers: plexHeaders(accessToken, range, "*/*"),
  });

  if (!streamResponse.ok && streamResponse.status !== 206) {
    return null;
  }

  const headers = new Headers();
  copyHeader(streamResponse.headers, headers, "content-type");
  copyHeader(streamResponse.headers, headers, "content-length");
  copyHeader(streamResponse.headers, headers, "content-range");
  copyHeader(streamResponse.headers, headers, "accept-ranges");
  headers.set("Cache-Control", "private, max-age=300");

  return new Response(streamResponse.body, {
    status: streamResponse.status,
    headers,
  });
}

function buildTranscodeUrl(serverUri: string, ratingKey: string, accessToken: string) {
  const url = new URL("/music/:/transcode/universal/start.mp3", serverUri);
  url.searchParams.set("path", `/library/metadata/${ratingKey}`);
  url.searchParams.set("protocol", "http");
  url.searchParams.set("directPlay", "0");
  url.searchParams.set("directStream", "0");
  url.searchParams.set("directStreamAudio", "0");
  url.searchParams.set("mediaIndex", "0");
  url.searchParams.set("partIndex", "0");
  url.searchParams.set("musicBitrate", "192");
  url.searchParams.set("audioChannelCount", "2");
  url.searchParams.set("location", "lan");
  url.searchParams.set("offset", "0");
  url.searchParams.set("transcodeSessionId", `mixarr-preview-${crypto.randomUUID()}`);
  url.searchParams.set("X-Plex-Token", accessToken);
  url.searchParams.set("X-Plex-Client-Identifier", plexClientIdentifier());
  url.searchParams.set("X-Plex-Product", "Mixarr");
  url.searchParams.set("X-Plex-Platform", "Web");
  return url;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const track = await prisma.track.findFirst({
    where: {
      id: params.id,
      library: {
        server: {
          userId,
        },
      },
    },
    include: {
      library: {
        include: {
          server: true,
        },
      },
    },
  });

  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  const server = track.library.server;
  const ratingKey = track.ratingKey || track.plexId;
  const range = req.headers.get("range");
  const transcodeResponse = await proxyPlexAudio(buildTranscodeUrl(server.uri, ratingKey, server.accessToken), server.accessToken, null);

  if (transcodeResponse) {
    return transcodeResponse;
  }

  const metadataResponse = await fetch(`${server.uri}/library/metadata/${ratingKey}`, {
    headers: plexHeaders(server.accessToken),
  });

  if (!metadataResponse.ok) {
    return NextResponse.json({ error: "Unable to load Plex metadata" }, { status: 502 });
  }

  const metadata = await metadataResponse.json();
  const media = metadata?.MediaContainer?.Metadata?.[0]?.Media || [];
  const part = media.flatMap((item: any) => item.Part || [])[0];
  const partKey = part?.key;

  if (!partKey) {
    return NextResponse.json({ error: "No playable media part found" }, { status: 404 });
  }

  const mediaUrl = new URL(partKey, server.uri);
  const directResponse = await proxyPlexAudio(mediaUrl, server.accessToken, range);

  if (!directResponse) {
    return NextResponse.json({ error: "Unable to stream Plex preview" }, { status: 502 });
  }

  return directResponse;
}
