import {
  getOpenRouterConfig,
  getOpenRouterTtsConfig,
  requireOpenRouterApiKey,
  resolveOpenRouterSiteUrlFromRequestContext,
} from "@/lib/env";
import { OPENROUTER_PCM_CHANNELS, OPENROUTER_PCM_SAMPLE_RATE } from "@/lib/pcm";
import { formatVertexTtsInput } from "@/lib/vertex-tts";

const OPENROUTER_SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";

export { OPENROUTER_PCM_CHANNELS, OPENROUTER_PCM_SAMPLE_RATE };

export type OpenRouterTtsStream = {
  body: ReadableStream<Uint8Array>;
  sampleRate: number;
  channels: number;
};

export type OpenRouterTtsAudio = {
  audio: ArrayBuffer;
  contentType: string;
};

type OpenRouterSpeechFormat = "pcm" | "mp3";

async function resolveSiteUrl(request?: Request): Promise<string> {
  if (request) {
    return getOpenRouterConfig(request).siteUrl;
  }

  return resolveOpenRouterSiteUrlFromRequestContext();
}

async function requestOpenRouterSpeech(
  text: string,
  responseFormat: OpenRouterSpeechFormat,
  request?: Request,
): Promise<Response> {
  const apiKey = requireOpenRouterApiKey();
  const routerConfig = getOpenRouterConfig(request);
  const ttsConfig = getOpenRouterTtsConfig();
  const input = formatVertexTtsInput(text, ttsConfig.voicePrompt);
  const siteUrl = await resolveSiteUrl(request);

  return fetch(OPENROUTER_SPEECH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": siteUrl,
      "X-OpenRouter-Title": routerConfig.appTitle,
    },
    body: JSON.stringify({
      model: ttsConfig.model,
      input,
      voice: ttsConfig.voice,
      response_format: responseFormat,
    }),
  });
}

export async function synthesizeSpeechStream(
  text: string,
  request?: Request,
): Promise<OpenRouterTtsStream> {
  const response = await requestOpenRouterSpeech(text, "pcm", request);

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

export async function synthesizeSpeechMp3(
  text: string,
  request?: Request,
): Promise<OpenRouterTtsAudio> {
  const response = await requestOpenRouterSpeech(text, "mp3", request);

  if (!response.ok) {
    throw new Error(await openRouterTtsError(response));
  }

  return {
    audio: await response.arrayBuffer(),
    contentType: response.headers.get("Content-Type") ?? "audio/mpeg",
  };
}

async function openRouterTtsError(response: Response) {
  const text = await response.text();
  return `OpenRouter TTS failed (${response.status}): ${text}`;
}
