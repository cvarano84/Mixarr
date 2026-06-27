import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

async function findOwnedTrack(userId: string, trackId: string) {
  return prisma.track.findFirst({
    where: {
      id: trackId,
      library: {
        server: {
          userId,
        },
      },
    },
    select: { id: true },
  });
}

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const track = await findOwnedTrack(userId, params.id);
  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  await prisma.blockedTrack.upsert({
    where: {
      userId_trackId: {
        userId,
        trackId: track.id,
      },
    },
    update: {},
    create: {
      userId,
      trackId: track.id,
    },
  });

  return NextResponse.json({ blocked: true });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.blockedTrack.deleteMany({
    where: {
      userId,
      trackId: params.id,
    },
  });

  return NextResponse.json({ blocked: false });
}
