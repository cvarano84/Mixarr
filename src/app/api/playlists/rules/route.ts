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

export async function GET() {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rules = await prisma.playlistRule.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ rules: rules.map(parseSavedRule) });
}

export async function POST(req: Request) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = savedPlaylistSchema.parse(body);

    const rule = await prisma.playlistRule.create({
      data: {
        userId,
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

    return NextResponse.json({ rule: parseSavedRule(rule) }, { status: 201 });
  } catch (error: any) {
    console.error("Save playlist rule error:", error);
    const status = error.name === "ZodError" ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? "Invalid saved playlist" : "Failed to save playlist" }, { status });
  }
}
