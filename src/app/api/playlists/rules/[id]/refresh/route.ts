import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { refreshSavedPlaylist } from "@/lib/playlistService";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rule = await prisma.playlistRule.findFirst({
    where: { id: params.id, userId },
  });

  if (!rule) {
    return NextResponse.json({ error: "Saved playlist not found" }, { status: 404 });
  }

  if (!rule.plexPlaylistId || !rule.serverId) {
    return NextResponse.json({ error: "Export this saved playlist once before refreshing it" }, { status: 400 });
  }

  const refreshedRule = await refreshSavedPlaylist(rule.id);
  return NextResponse.json({ rule: refreshedRule });
}
