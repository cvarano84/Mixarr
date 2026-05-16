import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { checkPin, findReachableConnection, getServers, getUser } from "@/lib/plex";
import prisma from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { pinId } = body;

    if (!pinId) {
      return NextResponse.json({ error: "Missing pinId" }, { status: 400 });
    }

    const pin = await checkPin(pinId);

    if (!pin.authToken) {
      return NextResponse.json({ status: "pending" });
    }

    // PIN is authenticated, get user details
    const plexUser = await getUser(pin.authToken);

    // Upsert User in DB
    const user = await prisma.user.upsert({
      where: { plexId: plexUser.id },
      update: {
        username: plexUser.username,
        email: plexUser.email,
        thumb: plexUser.thumb,
        accessToken: pin.authToken,
      },
      create: {
        plexId: plexUser.id,
        username: plexUser.username,
        email: plexUser.email,
        thumb: plexUser.thumb,
        accessToken: pin.authToken,
      },
    });

    cookies().set("mixarr_session", user.id, {
      httpOnly: true,
      secure: false, // Must be false for local HTTP access (like 192.168.x.x)
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    const plexServers = await getServers(pin.authToken);
    const discoveryStart = Date.now();
    let saved = 0;
    let skipped = 0;

    await Promise.all(
      plexServers.map(async (server) => {
        const result = await findReachableConnection(server.connections);

        if (!result.uri) {
          console.warn(
            `[Plex] Skipping server "${server.name}": no reachable connection ` +
              `(tried ${result.tried} in ${result.elapsedMs}ms)`,
          );
          skipped += 1;
          return;
        }

        await prisma.server.upsert({
          where: { machineIdentifier: server.clientIdentifier },
          update: {
            name: server.name,
            uri: result.uri,
            accessToken: server.accessToken,
            userId: user.id,
          },
          create: {
            machineIdentifier: server.clientIdentifier,
            name: server.name,
            uri: result.uri,
            accessToken: server.accessToken,
            userId: user.id,
          },
        });
        saved += 1;
      }),
    );

    console.log(
      `[Plex] Login complete for ${plexUser.username}: ` +
        `${saved} reachable / ${skipped} skipped ` +
        `(${plexServers.length} total in ${Date.now() - discoveryStart}ms)`,
    );

    return NextResponse.json({ status: "success", user });
  } catch (error) {
    console.error("Plex Auth Error", error);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
