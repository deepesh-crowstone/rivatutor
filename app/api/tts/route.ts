import { z } from "zod";
import { jsonError } from "@/lib/http";
import { isStreamingTtsProvider, synthesizeSpeech, synthesizeSpeechStream } from "@/lib/tts";

export const runtime = "nodejs";

const ttsSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  format: z.enum(["stream", "mp3", "wav"]).optional(),
});

export async function POST(request: Request) {
  try {
    const body = ttsSchema.parse(await request.json());
    const format = body.format ?? (isStreamingTtsProvider() ? "stream" : "wav");

    if (format === "stream" && isStreamingTtsProvider()) {
      const speech = await synthesizeSpeechStream(body.text, request);

      return new Response(speech.body, {
        headers: {
          "Content-Type": "audio/L16",
          "X-Audio-Sample-Rate": String(speech.sampleRate),
          "X-Audio-Channels": String(speech.channels),
          "X-Audio-Format": "pcm_s16le",
          "Cache-Control": "no-store",
        },
      });
    }

    const speech = await synthesizeSpeech(body.text, {
      format: format === "mp3" ? "mp3" : "wav",
      request,
    });

    return new Response(speech.audio, {
      headers: {
        "Content-Type": speech.contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
