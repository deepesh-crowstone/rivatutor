import { SAR_QUESTION_PROMPT, stripUiInstructions } from "@/lib/content";
import type { QuestionCardMetadata } from "@/lib/domain";

function parseQuestionMetadata(metadata: unknown): QuestionCardMetadata | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  return metadata as QuestionCardMetadata;
}

/** Remove ready-gate and advance prompts from spoken assistant text. */
export function stripReadyBoliyeFromSpeech(text: string): string {
  return text
    .replace(/\s*Aage badhne ke liye\s+'?ready'?\s+boliye\.?\s*/gi, " ")
    .replace(/\s*jab taiyaar ho(?:\s+tab)?\s*,?\s*'?ready'?\s+boliye\.?\s*/gi, " ")
    .replace(/\s*jab aap ready ho(?:\s+tab)?\s*,?\s*(?:toh\s+)?batana\.?\s*/gi, " ")
    .replace(/\s*jab aap taiyaar ho(?:\s+tab)?\s*,?\s*(?:toh\s+)?batana\.?\s*/gi, " ")
    .replace(/\s*jab aap ready ho(?:\s+tab)?\s*,?\s*(?:toh\s+)?bataye?in\.?\s*/gi, " ")
    .replace(/\s*ready ho(?:\s+tab)?\s*,?\s*(?:toh\s+)?batana\.?\s*/gi, " ")
    .replace(/\s*continue boliye\.?\s*/gi, " ")
    .replace(/\s*boliye\s+jab\s+aap\s+ready\s+ho\.?\s*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanSpokenText(text: string): string {
  return stripReadyBoliyeFromSpeech(stripUiInstructions(text).replace(/\s+/g, " ").trim());
}

/** Ordered TTS segments for an assistant chat message (intro, card prompt, then model sentence). */
export function buildAssistantSpeechSegments(message: {
  content: string;
  kind: string;
  metadata?: unknown;
}): string[] {
  const metadata = parseQuestionMetadata(message.metadata);
  const intro = cleanSpokenText(message.content);
  const isSarQuestion =
    message.kind === "question" && metadata?.questionType === "sar" && Boolean(metadata.expectedAnswer?.trim());

  if (isSarQuestion) {
    const segments: string[] = [];
    if (intro) {
      segments.push(intro);
    }

    const cardPrompt = (metadata?.questionPrompt ?? SAR_QUESTION_PROMPT).trim();
    if (cardPrompt) {
      segments.push(cardPrompt);
    }

    segments.push(metadata!.expectedAnswer!.trim());
    return segments;
  }

  const isOpenEndedQuestion =
    message.kind === "question" && metadata?.questionType === "open_ended";

  if (isOpenEndedQuestion) {
    const segments: string[] = [];
    if (intro) {
      segments.push(intro);
    }

    const cardPrompt = cleanSpokenText(metadata?.questionPrompt ?? "");
    if (cardPrompt) {
      segments.push(cardPrompt);
    }

    return segments;
  }

  return intro ? [intro] : [];
}
