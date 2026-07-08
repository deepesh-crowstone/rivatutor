import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/http";
import { submitIntentAnswer } from "@/lib/teacher";

export const runtime = "nodejs";

const intentSchema = z.object({
  answer: z.string().trim().min(1),
});

export async function POST(request: Request) {
  try {
    const body = intentSchema.parse(await request.json());
    return NextResponse.json(await submitIntentAnswer(body.answer));
  } catch (error) {
    return jsonError(error);
  }
}
