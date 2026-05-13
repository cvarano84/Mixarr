import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { checkPin, getUser, getServers, getLibraries } from "@/lib/plex";
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

    // Fetch user servers
    const plexServers = await getServers(pin.authToken);

    // Sync Servers to DB
    for (const server of plexServers) {
      let workingUri = null;

      // Prioritize local connections, then remote
      const sortedConnections = [...server.connections].sort((a, b) => (a.local === b.local ? 0 : a.local ? -1 : 1));

      // Test connections to find one that the Docker container can reach
      for (const conn of sortedConnections) {
        try {
          // Add a short timeout so we don't hang forever on bad IPs
          const res = await fetch(`${conn.uri}/identity`, {
            headers: { "Accept": "application/json" },
            signal: AbortSignal.timeout(2000)
          });
          if (res.ok) {
            workingUri = conn.uri;
            break;
          }
        } catch (e) {
          // Connection failed, try the next one
          console.log(`Connection to ${conn.uri} failed:`, e);
        }
      }

      if (!workingUri) {
        console.warn(`Could not find a working connection for server ${server.name}`);
        continue;
      }

      await prisma.server.upsert({
        where: { machineIdentifier: server.clientIdentifier },
        update: {
          name: server.name,
          uri: workingUri,
          accessToken: server.accessToken,
          userId: user.id,
        },
        create: {
          machineIdentifier: server.clientIdentifier,
          name: server.name,
          uri: workingUri,
          accessToken: server.accessToken,
          userId: user.id,
        },
      });
    }

    // Set a simple session cookie
    cookies().set("mixarr_session", user.id, {
      httpOnly: true,
      secure: false, // Must be false for local HTTP access (like 192.168.x.x)
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    return NextResponse.json({ status: "success", user });
  } catch (error) {
    console.error("Plex Auth Error", error);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
