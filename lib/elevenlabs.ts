import { getElevenLabsConfig, requireElevenLabsApiKey } from "@/lib/env";

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";

export async function transcribeAudio(input: {
  file: File | Blob;
  filename: string;
  language?: string;
}): Promise<string> {
  const apiKey = requireElevenLabsApiKey();
  const config = getElevenLabsConfig();
  const formData = new FormData();
  formData.append("file", input.file, input.filename);
  formData.append("model_id", config.sttModel);
  formData.append("language_code", input.language ?? config.sttLanguage);

  const response = await fetch(`${ELEVENLABS_BASE_URL}/speech-to-text`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await elevenLabsError(response, "speech-to-text"));
  }

  const payload = (await response.json()) as { text?: string };
  if (!payload.text?.trim()) {
    throw new Error("ElevenLabs returned an empty transcription.");
  }

  return payload.text.trim();
}

export async function synthesizeSpeech(text: string): Promise<{
  audio: ArrayBuffer;
  contentType: string;
}> {
  const apiKey = requireElevenLabsApiKey();
  const config = getElevenLabsConfig();
  const response = await fetch(
    `${ELEVENLABS_BASE_URL}/text-to-speech/${config.voiceId}?output_format=${config.ttsOutputFormat}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: config.ttsModel,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await elevenLabsError(response, "text-to-speech"));
  }

  return {
    audio: await response.arrayBuffer(),
    contentType: response.headers.get("content-type") ?? "audio/mpeg",
  };
}

async function elevenLabsError(response: Response, label: string) {
  const text = await response.text();
  return `ElevenLabs ${label} failed (${response.status}): ${text}`;
}
