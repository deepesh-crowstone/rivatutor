import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/http";
import { submitLessonAnswer } from "@/lib/teacher";

export const runtime = "nodejs";

const answerSchema = z.object({
  answer: z.string().default(""),
});

export async function POST(request: Request) {
  try {
    const body = answerSchema.parse(await request.json());
    return NextResponse.json(await submitLessonAnswer(body.answer));
  } catch (error) {
    return jsonError(error);
  }
}
