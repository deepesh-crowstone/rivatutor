import {
  getOpenRouterConfig,
  getOpenRouterSttConfig,
  requireOpenRouterApiKey,
  resolveOpenRouterSiteUrlFromRequestContext,
} from "@/lib/env";

const OPENROUTER_TRANSCRIPTIONS_URL = "https://openrouter.ai/api/v1/audio/transcriptions";

export async function transcribeAudioWithOpenRouter(input: {
  file: File | Blob;
  format: string;
  language?: string;
  request?: Request;
}): Promise<string> {
  const apiKey = requireOpenRouterApiKey();
  const config = getOpenRouterSttConfig();
  const siteUrl = input.request
    ? getOpenRouterConfig(input.request).siteUrl
    : await resolveOpenRouterSiteUrlFromRequestContext();
  const appTitle = getOpenRouterConfig(input.request).appTitle;

  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const data = Buffer.from(bytes).toString("base64");
  const format = normalizeAudioFormat(input.format);
  const language = input.language ?? config.language;

  const response = await fetch(OPENROUTER_TRANSCRIPTIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": siteUrl,
      "X-OpenRouter-Title": appTitle,
    },
    body: JSON.stringify({
      model: config.model,
      input_audio: {
        data,
        format,
      },
      ...(language ? { language } : {}),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter STT failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as { text?: string };
  if (!payload.text?.trim()) {
    throw new Error("OpenRouter returned an empty transcription.");
  }

  return payload.text.trim();
}

function normalizeAudioFormat(format: string): string {
  const normalized = format.trim().toLowerCase().replace(/^\./, "");
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("mpeg") || normalized === "mp3") return "mp3";
  if (normalized.includes("mp4") || normalized === "m4a") return "m4a";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("flac")) return "flac";
  if (normalized.includes("aac")) return "aac";
  return normalized || "webm";
}
