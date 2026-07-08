import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { submitUsername } from "@/lib/username";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { username?: string };
    const username = body.username?.trim();
    if (!username) {
      return jsonError(new Error("Please tell Riva a username."), 400);
    }

    return NextResponse.json(await submitUsername(username));
  } catch (error) {
    return jsonError(error, 400);
  }
}
