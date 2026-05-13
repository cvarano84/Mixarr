import { NextResponse } from "next/server";
import { requestPin } from "@/lib/plex";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pin = await requestPin();
    
    // Construct the Plex Auth URL
    const clientIdentifier = (process.env.PLEX_CLIENT_IDENTIFIER || "mixarr-default-client").trim();
    const authAppUrl = `https://app.plex.tv/auth#?clientID=${clientIdentifier}&code=${pin.code}&context[device][product]=${(process.env.PLEX_PRODUCT_NAME || "Mixarr").trim()}`;

    return NextResponse.json({
      pinId: pin.id,
      code: pin.code,
      authUrl: authAppUrl,
    });
  } catch (error) {
    console.error("Failed to request Plex PIN", error);
    return NextResponse.json({ error: "Failed to request Plex PIN" }, { status: 500 });
  }
}
