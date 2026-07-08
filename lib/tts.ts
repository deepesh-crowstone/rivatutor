import { synthesizeSpeech as synthesizeWithElevenLabs } from "@/lib/elevenlabs";
import { getTtsProvider } from "@/lib/env";
import { synthesizeSpeechStream as synthesizeWithOpenRouter } from "@/lib/openrouter-tts";
import { pcmToWav, synthesizeSpeech as synthesizeWithVertex } from "@/lib/vertex-tts";

export { OPENROUTER_PCM_CHANNELS, OPENROUTER_PCM_SAMPLE_RATE } from "@/lib/openrouter-tts";

export function isStreamingTtsProvider(): boolean {
  return getTtsProvider() === "openrouter";
}

export async function synthesizeSpeechStream(text: string) {
  if (!isStreamingTtsProvider()) {
    throw new Error("Streaming TTS is only available when TTS_PROVIDER=openrouter.");
  }

  return synthesizeWithOpenRouter(text);
}

export async function synthesizeSpeech(text: string): Promise<{
  audio: ArrayBuffer;
  contentType: string;
}> {
  if (getTtsProvider() === "elevenlabs") {
    return synthesizeWithElevenLabs(text);
  }

  if (getTtsProvider() === "vertex") {
    return synthesizeWithVertex(text);
  }

  const stream = await synthesizeWithOpenRouter(text);
  const pcm = await readStreamToUint8Array(stream.body);

  return {
    audio: pcmToWav(pcm, stream.sampleRate, stream.channels),
    contentType: "audio/wav",
  };
}

async function readStreamToUint8Array(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value?.length) {
      chunks.push(value);
      totalLength += value.length;
    }
  }

  const pcm = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    pcm.set(chunk, offset);
    offset += chunk.length;
  }

  return pcm;
}
