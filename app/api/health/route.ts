import { NextResponse } from "next/server";
import { resolveUsePostgres } from "@/lib/db-provider";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const provider = resolveUsePostgres() ? "postgresql" : "sqlite";

  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      ok: true,
      provider,
      database: "connected",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database check failed.";

    return NextResponse.json(
      {
        ok: false,
        provider,
        database: "error",
        error: message,
      },
      { status: 503 },
    );
  }
}
