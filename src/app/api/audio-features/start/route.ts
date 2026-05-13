import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { runAudioFeatureEngine } from "@/lib/audioFeatureEngine";

export async function POST() {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fire and forget the background job
    runAudioFeatureEngine().catch(console.error);

    return NextResponse.json({ status: "started", message: "Audio Feature sync job initiated" });
  } catch (error) {
    console.error("Failed to start audio feature sync", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
