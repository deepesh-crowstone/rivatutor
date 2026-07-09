import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { transcribeAudio } from "@/lib/stt";

export const runtime = "nodejs";

const MIME_FORMATS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/webm;codecs=opus": "webm",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
};

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audio = formData.get("audio");
    if (!(audio instanceof File)) {
      throw new Error("Upload an audio file in the 'audio' form field.");
    }

    const format = MIME_FORMATS[audio.type] ?? audio.name.split(".").pop() ?? "webm";
    const text = await transcribeAudio({
      file: audio,
      filename: audio.name || `riva-answer.${format}`,
      format,
      request,
    });

    return NextResponse.json({ text });
  } catch (error) {
    return jsonError(error);
  }
}
