import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { normalizeOptionalNonNegativeInteger, syncSettingKeys } from "@/lib/syncSettings";

const syncSettingsSelect = {
  plexPageSize: true,
  popularityBatchSize: true,
  audioFeatureBatchSize: true,
  tagBatchSize: true,
  bpmBatchSize: true,
  providerDelayMs: true,
} as const;

export async function GET() {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await prisma.syncSettings.findUnique({
    where: { userId },
    select: syncSettingsSelect,
  });

  return NextResponse.json(
    settings || Object.fromEntries(syncSettingKeys.map((key) => [key, null]))
  );
}

export async function PUT(req: Request) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const data = Object.fromEntries(
    syncSettingKeys.map((key) => [key, normalizeOptionalNonNegativeInteger(body[key])])
  );

  const settings = await prisma.syncSettings.upsert({
    where: { userId },
    update: data,
    create: {
      userId,
      ...data,
    },
    select: syncSettingsSelect,
  });

  return NextResponse.json(settings);
}
