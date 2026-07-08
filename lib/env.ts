export const OPENROUTER_CHAT_MODEL = "google/gemini-3.1-flash-lite";

/** Default Gemini TTS style prefix — friendly teacher with subtle Indian accent. */
export const DEFAULT_TTS_VOICE_PROMPT =
  "The voice should balance three qualities: a friendly conversation partner, a teacher, and a real human speaker. Accent should be very subtle indian.";

function resolveTtsVoicePrompt(envValue: string | undefined): string {
  const trimmed = envValue?.trim();
  return trimmed || DEFAULT_TTS_VOICE_PROMPT;
}

const DEFAULT_OPENROUTER_SITE_URL = "http://localhost:3000";

function isLocalhostSiteUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function deriveSiteUrlFromHeaderSource(source: Request | Headers): string | null {
  const getHeader = (name: string) =>
    source instanceof Request ? source.headers.get(name) : source.get(name);

  const forwardedHost = getHeader("x-forwarded-host");
  const host = forwardedHost?.split(",")[0]?.trim() ?? getHeader("host")?.trim();
  if (!host) {
    return null;
  }

  const forwardedProto = getHeader("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto =
    forwardedProto ??
    (host.includes("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");

  return `${proto}://${host}`;
}

/** Prefer explicit env URL; otherwise derive from the incoming request host on Railway/production. */
export function resolveOpenRouterSiteUrl(source?: Request | Headers): string {
  const envUrl = process.env.OPENROUTER_SITE_URL?.trim();
  if (envUrl && !isLocalhostSiteUrl(envUrl)) {
    return envUrl;
  }

  if (source) {
    const derived = deriveSiteUrlFromHeaderSource(source);
    if (derived) {
      return derived;
    }
  }

  return envUrl || DEFAULT_OPENROUTER_SITE_URL;
}

export async function resolveOpenRouterSiteUrlFromRequestContext(): Promise<string> {
  try {
    const { headers } = await import("next/headers");
    return resolveOpenRouterSiteUrl(await headers());
  } catch {
    return resolveOpenRouterSiteUrl();
  }
}

export function getOpenRouterConfig(source?: Request | Headers) {
  return {
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    siteUrl: resolveOpenRouterSiteUrl(source),
    appTitle: process.env.OPENROUTER_APP_TITLE ?? "Riva Teacher POC",
  };
}

export function requireOpenRouterApiKey(): string {
  const { apiKey } = getOpenRouterConfig();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required for Riva's LLM services.");
  }

  return apiKey;
}

export type TtsProvider = "openrouter" | "vertex" | "elevenlabs";

export function getTtsProvider(): TtsProvider {
  const provider = (process.env.TTS_PROVIDER ?? "openrouter").trim().toLowerCase();
  if (provider === "elevenlabs") {
    return "elevenlabs";
  }
  if (provider === "vertex") {
    return "vertex";
  }
  return "openrouter";
}

export function getOpenRouterTtsConfig() {
  return {
    model: process.env.OPENROUTER_TTS_MODEL ?? "google/gemini-3.1-flash-tts-preview",
    voice: process.env.OPENROUTER_TTS_VOICE ?? "Kore",
    voicePrompt: resolveTtsVoicePrompt(process.env.OPENROUTER_TTS_VOICE_PROMPT),
  };
}

export function getVertexTtsConfig() {
  return {
    apiKey: process.env.VERTEX_API_KEY ?? "",
    model: process.env.VERTEX_TTS_MODEL ?? "gemini-3.1-flash-tts-preview",
    voice: process.env.VERTEX_TTS_VOICE ?? "Kore",
    voicePrompt: resolveTtsVoicePrompt(process.env.VERTEX_TTS_VOICE_PROMPT),
  };
}

export function requireVertexApiKey(): string {
  const { apiKey } = getVertexTtsConfig();
  if (!apiKey) {
    throw new Error(
      "VERTEX_API_KEY is required when TTS_PROVIDER=vertex. Add a Google AI / Gemini API key from AI Studio.",
    );
  }

  return apiKey;
}

export function getElevenLabsConfig() {
  return {
    apiKey: process.env.ELEVENLABS_API_KEY ?? "",
    voiceId: process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM",
    ttsModel: process.env.ELEVENLABS_TTS_MODEL ?? "eleven_multilingual_v2",
    ttsOutputFormat: process.env.ELEVENLABS_TTS_OUTPUT_FORMAT ?? "mp3_44100_128",
    sttModel: process.env.ELEVENLABS_STT_MODEL ?? "scribe_v2",
    sttLanguage: process.env.ELEVENLABS_STT_LANGUAGE ?? "eng",
  };
}

export function requireElevenLabsApiKey(): string {
  const { apiKey } = getElevenLabsConfig();
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is required for speech-to-text.");
  }

  return apiKey;
}

export function hasRequiredApiKeys() {
  if (!getOpenRouterConfig().apiKey || !getElevenLabsConfig().apiKey) {
    return false;
  }

  if (getTtsProvider() === "vertex") {
    return Boolean(getVertexTtsConfig().apiKey);
  }

  return true;
}
