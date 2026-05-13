import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

export async function GET() {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const servers = await prisma.server.findMany({
      where: { userId },
      include: { libraries: true },
    });

    return NextResponse.json({ servers });
  } catch (error) {
    console.error("Failed to fetch servers", error);
    return NextResponse.json({ error: "Failed to fetch servers" }, { status: 500 });
  }
}
