import { transcribeAudio as transcribeWithElevenLabs } from "@/lib/elevenlabs";
import { getSttProvider } from "@/lib/env";
import { transcribeAudioWithOpenRouter } from "@/lib/openrouter-stt";

export async function transcribeAudio(input: {
  file: File | Blob;
  filename: string;
  format: string;
  language?: string;
  request?: Request;
}): Promise<string> {
  if (getSttProvider() === "elevenlabs") {
    return transcribeWithElevenLabs({
      file: input.file,
      filename: input.filename,
      language: input.language,
    });
  }

  return transcribeAudioWithOpenRouter({
    file: input.file,
    format: input.format,
    language: input.language,
    request: input.request,
  });
}
