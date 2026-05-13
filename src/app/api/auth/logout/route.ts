import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST() {
  cookies().delete("mixarr_session");
  return NextResponse.json({ status: "success" });
}
