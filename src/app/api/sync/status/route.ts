import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildPoolBusyStatusPayload, isPrismaConnectionPoolTimeout } from "@/lib/databaseErrors";
import { getJobDebugSnapshot } from "@/lib/jobLock";
import { getSyncStatusPayload } from "@/lib/syncStatusPayload";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await getSyncStatusPayload(userId);
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (isPrismaConnectionPoolTimeout(error)) {
      const payload = {
        ...buildPoolBusyStatusPayload(error, { context: "/api/sync/status", model: "User" }),
        debug: {
          jobs: getJobDebugSnapshot(),
        },
      };
      return NextResponse.json(payload, {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(payload.retryAfterSeconds),
        },
      });
    }

    console.error("Status fetch error", error);
    return NextResponse.json({ error: "Failed to get status" }, { status: 500 });
  }
}
