import type { ChatMessageDto } from "@/lib/domain";

/** Index of the latest user message, or -1 when the thread has none yet. */
export function findLastUserMessageIndex(messages: ChatMessageDto[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }

  return -1;
}

/**
 * Assistant messages that should be spoken next.
 * Only messages after the latest user turn are eligible; anything earlier is permanently skipped.
 * Within the active turn, messages already fully spoken (lastSpokenId) are also skipped.
 */
export function getPendingAssistantMessagesForTts(
  messages: ChatMessageDto[],
  lastSpokenId: string | null,
): ChatMessageDto[] {
  if (messages.length === 0) {
    return [];
  }

  const lastUserIndex = findLastUserMessageIndex(messages);
  let startIndex = lastUserIndex >= 0 ? lastUserIndex + 1 : 0;

  if (lastSpokenId) {
    const lastSpokenIndex = messages.findIndex((message) => message.id === lastSpokenId);
    if (lastSpokenIndex >= 0) {
      startIndex = Math.max(startIndex, lastSpokenIndex + 1);
    }
  }

  return messages.slice(startIndex).filter((message) => message.role === "assistant");
}

/** Mark an interrupted assistant message as handled so it never replays. */
export function markAssistantMessageSkipped(
  messages: ChatMessageDto[],
  messageId: string | null,
  lastSpokenId: string | null,
): string | null {
  if (!messageId) {
    return lastSpokenId;
  }

  const messageIndex = messages.findIndex((message) => message.id === messageId);
  if (messageIndex < 0 || messages[messageIndex]?.role !== "assistant") {
    return lastSpokenId;
  }

  if (!lastSpokenId) {
    return messageId;
  }

  const lastSpokenIndex = messages.findIndex((message) => message.id === lastSpokenId);
  if (lastSpokenIndex < 0) {
    return messageId;
  }

  return messageIndex > lastSpokenIndex ? messageId : lastSpokenId;
}
