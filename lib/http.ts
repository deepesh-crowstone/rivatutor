import { NextResponse } from "next/server";

export function jsonError(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return NextResponse.json({ error: message }, { status });
}
