import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const { rules, limit = 100 } = await req.json();

    let whereClause: any = {
      AND: [],
      NOT: []
    };

    if (rules && Array.isArray(rules)) {
      for (const rule of rules) {
        const { field, operator, value } = rule;

        const isNumericField = ['popularity', 'energy', 'valence', 'tempo', 'year'].includes(field);
        let prismaCondition: any = {};

        if (isNumericField) {
          const numValue = Number(value);
          if (operator === 'eq' || operator === 'contains') prismaCondition = numValue; // Fallback 'contains' to '=' for numbers
          else if (operator === 'not_contains') prismaCondition = numValue; // Will be pushed to NOT array as equality
          else if (operator === 'gt') prismaCondition = { gt: numValue };
          else if (operator === 'lt') prismaCondition = { lt: numValue };
          else if (operator === 'gte') prismaCondition = { gte: numValue };
          else if (operator === 'lte') prismaCondition = { lte: numValue };
        } else {
          // String fields
          if (operator === 'eq') prismaCondition = value;
          else if (operator === 'contains' || operator === 'not_contains') prismaCondition = { contains: value, mode: 'insensitive' };
          else if (operator === 'gt') prismaCondition = { gt: value }; // Prisma technically supports string comparison
          else if (operator === 'lt') prismaCondition = { lt: value };
          else if (operator === 'gte') prismaCondition = { gte: value };
          else if (operator === 'lte') prismaCondition = { lte: value };
        }

        const pushTarget = operator === 'not_contains' ? whereClause.NOT : whereClause.AND;

        if (field === 'popularity') {
          pushTarget.push({ popularity: { score: prismaCondition } });
        } else if (field === 'energy') {
          pushTarget.push({ audioFeature: { energy: prismaCondition } });
        } else if (field === 'valence') {
          pushTarget.push({ audioFeature: { valence: prismaCondition } });
        } else if (field === 'tempo') {
          pushTarget.push({ audioFeature: { tempo: prismaCondition } });
        } else if (field === 'year') {
          pushTarget.push({ album: { year: prismaCondition } });
        } else if (field === 'genre') {
          pushTarget.push({
            OR: [
              { artist: { tags: { some: { type: 'genre', name: prismaCondition } } } },
              { tags: { some: { type: 'genre', name: prismaCondition } } }
            ]
          });
        } else if (field === 'title') {
          pushTarget.push({ title: prismaCondition });
        } else if (field === 'artist') {
          pushTarget.push({ artist: { title: prismaCondition } });
        }
      }
    }

    if (whereClause.AND.length === 0) {
      delete whereClause.AND;
    }
    if (whereClause.NOT.length === 0) {
      delete whereClause.NOT;
    }

    const tracks = await prisma.track.findMany({
      where: whereClause,
      include: {
        artist: true,
        album: true,
        popularity: true,
        audioFeature: true
      },
      take: Number(limit),
      orderBy: { popularity: { score: 'desc' } }
    });

    return NextResponse.json({ tracks });
  } catch (error) {
    console.error("Generate error:", error);
    return NextResponse.json({ error: "Failed to generate playlist" }, { status: 500 });
  }
}
