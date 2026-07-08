import { getVertexTtsConfig, requireVertexApiKey } from "@/lib/env";

// Gemini TTS via Google AI Interactions API (API-key auth from AI Studio).
// Configure VERTEX_API_KEY, VERTEX_TTS_VOICE, and optional VERTEX_TTS_VOICE_PROMPT in .env.
// Set TTS_PROVIDER=openrouter (default), vertex, or elevenlabs; STT stays on ElevenLabs.

const GEMINI_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

type GeminiInteractionResponse = {
  output_audio?: {
    data?: string;
    mime_type?: string;
  };
  error?: {
    message?: string;
  };
};

export function formatVertexTtsInput(text: string, voicePrompt: string): string {
  const trimmedPrompt = voicePrompt.trim();
  if (!trimmedPrompt) {
    return text;
  }

  return `${trimmedPrompt}: ${text}`;
}

export function pcmToWav(
  pcm: Uint8Array,
  sampleRate = 24000,
  channels = 1,
  bitsPerSample = 16,
): ArrayBuffer {
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcm);

  return buffer;
}

function decodeBase64Audio(data: string): Uint8Array {
  const binary = Buffer.from(data, "base64");
  return new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength);
}

function resolveAudioPayload(
  mimeType: string | undefined,
  audioBytes: Uint8Array,
): { audio: ArrayBuffer; contentType: string } {
  const normalizedMime = (mimeType ?? "").toLowerCase();

  if (normalizedMime.includes("wav")) {
    return {
      audio: audioBytes.buffer.slice(
        audioBytes.byteOffset,
        audioBytes.byteOffset + audioBytes.byteLength,
      ) as ArrayBuffer,
      contentType: "audio/wav",
    };
  }

  return {
    audio: pcmToWav(audioBytes),
    contentType: "audio/wav",
  };
}

export async function synthesizeSpeech(text: string): Promise<{
  audio: ArrayBuffer;
  contentType: string;
}> {
  const apiKey = requireVertexApiKey();
  const config = getVertexTtsConfig();
  const input = formatVertexTtsInput(text, config.voicePrompt);

  const response = await fetch(GEMINI_INTERACTIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      model: config.model,
      input,
      response_format: { type: "audio" },
      generation_config: {
        speech_config: [{ voice: config.voice }],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(await vertexTtsError(response));
  }

  const payload = (await response.json()) as GeminiInteractionResponse;
  const encodedAudio = payload.output_audio?.data;
  if (!encodedAudio) {
    throw new Error(
      payload.error?.message ??
        "Gemini TTS returned no audio. Check VERTEX_TTS_VOICE and VERTEX_TTS_VOICE_PROMPT.",
    );
  }

  const audioBytes = decodeBase64Audio(encodedAudio);
  return resolveAudioPayload(payload.output_audio?.mime_type, audioBytes);
}

async function vertexTtsError(response: Response) {
  const text = await response.text();
  return `Gemini TTS failed (${response.status}): ${text}`;
}
