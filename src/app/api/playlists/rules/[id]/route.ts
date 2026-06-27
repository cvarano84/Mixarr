import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { savedPlaylistSchema } from "@/lib/playlistService";

function parseSavedRule(rule: any) {
  const parsedRules = JSON.parse(rule.rulesJson);
  return {
    ...rule,
    rules: Array.isArray(parsedRules) ? parsedRules : [],
    ruleTree: Array.isArray(parsedRules) ? undefined : parsedRules,
    options: JSON.parse(rule.optionsJson || "{}"),
    rulesJson: undefined,
    optionsJson: undefined,
  };
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const existingRule = await prisma.playlistRule.findFirst({
      where: { id: params.id, userId },
    });

    if (!existingRule) {
      return NextResponse.json({ error: "Saved playlist not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = savedPlaylistSchema.parse(body);
    const rule = await prisma.playlistRule.update({
      where: { id: existingRule.id },
      data: {
        name: parsed.name,
        serverId: parsed.serverId || null,
        libraryId: parsed.libraryId || null,
        rulesJson: JSON.stringify(parsed.ruleTree || parsed.rules),
        optionsJson: JSON.stringify({
          duplicateStrategy: parsed.duplicateStrategy,
          preferNonLive: parsed.preferNonLive,
          excludeRemasters: parsed.excludeRemasters,
          negativeFilters: parsed.negativeFilters,
        }),
        limit: parsed.limit,
        autoRefresh: parsed.autoRefresh,
      },
    });

    return NextResponse.json({ rule: parseSavedRule(rule) });
  } catch (error: any) {
    console.error("Update playlist rule error:", error);
    const status = error.name === "ZodError" ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? "Invalid saved playlist" : "Failed to update playlist" }, { status });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await prisma.playlistRule.deleteMany({
    where: { id: params.id, userId },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Saved playlist not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
