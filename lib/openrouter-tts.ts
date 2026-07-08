import { getOpenRouterConfig, getOpenRouterTtsConfig, requireOpenRouterApiKey } from "@/lib/env";
import { OPENROUTER_PCM_CHANNELS, OPENROUTER_PCM_SAMPLE_RATE } from "@/lib/pcm";
import { formatVertexTtsInput } from "@/lib/vertex-tts";

const OPENROUTER_SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";

export { OPENROUTER_PCM_CHANNELS, OPENROUTER_PCM_SAMPLE_RATE };

export type OpenRouterTtsStream = {
  body: ReadableStream<Uint8Array>;
  sampleRate: number;
  channels: number;
};

export async function synthesizeSpeechStream(text: string): Promise<OpenRouterTtsStream> {
  const apiKey = requireOpenRouterApiKey();
  const routerConfig = getOpenRouterConfig();
  const ttsConfig = getOpenRouterTtsConfig();
  const input = formatVertexTtsInput(text, ttsConfig.voicePrompt);

  const response = await fetch(OPENROUTER_SPEECH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": routerConfig.siteUrl,
      "X-OpenRouter-Title": routerConfig.appTitle,
    },
    body: JSON.stringify({
      model: ttsConfig.model,
      input,
      voice: ttsConfig.voice,
      response_format: "pcm",
    }),
  });

  if (!response.ok) {
    throw new Error(await openRouterTtsError(response));
  }

  if (!response.body) {
    throw new Error("OpenRouter TTS returned no stream body.");
  }

  return {
    body: response.body,
    sampleRate: OPENROUTER_PCM_SAMPLE_RATE,
    channels: OPENROUTER_PCM_CHANNELS,
  };
}

async function openRouterTtsError(response: Response) {
  const text = await response.text();
  return `OpenRouter TTS failed (${response.status}): ${text}`;
}
