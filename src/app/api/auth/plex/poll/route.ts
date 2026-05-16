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

    // Set the session cookie before doing the (still potentially slow)
    // server discovery. From the user's perspective they're authenticated
    // at this point; even if discovery fails or the browser disconnects,
    // they'll be logged in next time they load the dashboard.
    cookies().set("mixarr_session", user.id, {
      httpOnly: true,
      secure: false, // Must be false for local HTTP access (like 192.168.x.x)
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    // Discover the user's Plex servers and pick a reachable connection
    // for each.
    //
    // Plex's /resources endpoint returns every server the user has
    // access to - including friends' servers shared via Plex Home and
    // remote relays that the Mixarr container can't route to. Previously
    // we tested each server's connections sequentially with a 2s timeout
    // per attempt, which meant a user with a handful of shared servers
    // sat through 20-30 seconds of unexplained "Waiting for Plex..."
    // while the backend ground through timeouts, and every single failed
    // connection produced a multi-line DOMException stack trace in the
    // container logs.
    //
    // Now we race all connections for a single server in parallel (first
    // success wins, the rest are aborted), and process all servers
    // concurrently, so the whole discovery step is bounded by the
    // 1500ms per-connection timeout regardless of how many shared servers
    // the user has.
    const plexServers = await getServers(pin.authToken);

    const discoveryStart = Date.now();
    let saved = 0;
    let skipped = 0;

    await Promise.all(
      plexServers.map(async (server) => {
        const result = await findReachableConnection(server.connections);

        if (!result.uri) {
          // One concise warn per unreachable server instead of the
          // previous one-stack-trace-per-failed-connection deluge. This
          // is expected for any server the container's network can't
          // reach (friends' servers, remote-only servers, etc.).
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
