import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exportTracksToPlex } from "@/lib/playlistService";

export async function POST(req: Request) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { name, trackIds, savedRuleId, rulesSnapshot, optionsSnapshot } = await req.json();

    if (!name || !trackIds || !Array.isArray(trackIds) || trackIds.length === 0) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const result = await exportTracksToPlex({
      userId,
      name,
      trackIds,
      savedRuleId,
      rulesJson: rulesSnapshot ? JSON.stringify(rulesSnapshot) : undefined,
      optionsJson: optionsSnapshot ? JSON.stringify(optionsSnapshot) : undefined,
    });

    return NextResponse.json({ success: true, ...result });

  } catch (error: any) {
    console.error("Export to Plex failed:", error.response?.data || error.message);
    const message = error.message || "Failed to export playlist to Plex";
    const status = message.includes("not owned") || message.includes("not found") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
