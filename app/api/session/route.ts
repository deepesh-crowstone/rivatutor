import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { getAppState } from "@/lib/state";
import { resetSession } from "@/lib/username";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getAppState());
  } catch (error) {
    return jsonError(error, 500);
  }
}

export async function DELETE() {
  try {
    return NextResponse.json(await resetSession());
  } catch (error) {
    return jsonError(error, 500);
  }
}
