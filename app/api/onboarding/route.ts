import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/http";
import { submitOnboardingAnswer } from "@/lib/onboarding";

export const runtime = "nodejs";

const onboardingSchema = z.object({
  answer: z.string().trim().min(1),
});

export async function POST(request: Request) {
  try {
    const body = onboardingSchema.parse(await request.json());
    return NextResponse.json(await submitOnboardingAnswer(body.answer));
  } catch (error) {
    return jsonError(error);
  }
}
