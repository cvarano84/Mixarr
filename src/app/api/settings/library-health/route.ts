import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getLibraryHealth } from "@/lib/libraryHealth";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return NextResponse.json({ libraries: await getLibraryHealth(userId) });
  } catch (error) {
    console.error("[LibraryHealth] Failed to load summary", error);
    return NextResponse.json({ error: "Failed to load library health" }, { status: 500 });
  }
}
