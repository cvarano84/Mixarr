import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { isRefreshInFlight, refreshSavedPlaylist } from "@/lib/playlistService";

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

  // Reject the request rather than queue behind an in-flight refresh: a
  // double-click on the UI or a manual click while the nightly cron is
  // mid-run would otherwise interleave delete-items + add-items calls on
  // the same Plex playlist. The lock inside refreshSavedPlaylist is the
  // authoritative guard (it covers the cron path too); this check is just
  // here so the user gets a precise 409 instead of an opaque null result.
  if (isRefreshInFlight(rule.id)) {
    return NextResponse.json({ error: "This saved playlist is already refreshing" }, { status: 409 });
  }

  const refreshedRule = await refreshSavedPlaylist(rule.id);
  return NextResponse.json({ rule: refreshedRule });
}
