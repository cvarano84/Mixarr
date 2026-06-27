import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

export async function GET() {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { defaultServerId: true, defaultLibraryId: true },
  });
  const servers = await prisma.server.findMany({
    where: { userId },
    include: { libraries: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    defaultServerId: user?.defaultServerId || servers[0]?.id || "",
    defaultLibraryId: user?.defaultLibraryId || servers[0]?.libraries[0]?.id || "",
    servers,
  });
}

export async function PUT(req: Request) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serverId, libraryId } = await req.json();
  const library = libraryId
    ? await prisma.library.findFirst({
      where: {
        id: libraryId,
        server: { userId, ...(serverId ? { id: serverId } : {}) },
      },
    })
    : null;

  if (libraryId && !library) {
    return NextResponse.json({ error: "Library not found" }, { status: 404 });
  }

  const server = serverId
    ? await prisma.server.findFirst({ where: { id: serverId, userId } })
    : null;

  if (serverId && !server) {
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      defaultServerId: serverId || null,
      defaultLibraryId: libraryId || null,
    },
    select: { defaultServerId: true, defaultLibraryId: true },
  });

  return NextResponse.json(user);
}
