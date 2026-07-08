import { z } from "zod";
import { jsonError } from "@/lib/http";
import { isStreamingTtsProvider, synthesizeSpeech, synthesizeSpeechStream } from "@/lib/tts";

export const runtime = "nodejs";

const ttsSchema = z.object({
  text: z.string().trim().min(1).max(4000),
});

export async function POST(request: Request) {
  try {
    const body = ttsSchema.parse(await request.json());

    if (isStreamingTtsProvider()) {
      const speech = await synthesizeSpeechStream(body.text);

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

    const speech = await synthesizeSpeech(body.text);

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
