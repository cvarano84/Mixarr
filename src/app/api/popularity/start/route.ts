import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { runPopularityEngine } from "@/lib/popularityEngine";
import { getUserSyncSettings } from "@/lib/syncSettings";

export async function POST() {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const syncSettings = await getUserSyncSettings(userId);
    // Fire and forget the background job
    runPopularityEngine(syncSettings).catch(console.error);

    return NextResponse.json({ status: "started", message: "Popularity sync job initiated" });
  } catch (error) {
    console.error("Failed to start popularity sync", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
