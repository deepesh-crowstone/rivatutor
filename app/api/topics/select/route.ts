import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/http";
import { lockTopic } from "@/lib/teacher";

export const runtime = "nodejs";

const topicSchema = z
  .object({
    topicId: z.string().optional(),
    freeformTitle: z.string().trim().optional(),
  })
  .refine((value) => value.topicId || value.freeformTitle, {
    message: "Choose a topic or enter a topic request.",
  });

export async function POST(request: Request) {
  try {
    const body = topicSchema.parse(await request.json());
    return NextResponse.json(await lockTopic(body));
  } catch (error) {
    return jsonError(error);
  }
}
