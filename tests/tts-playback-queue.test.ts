import { describe, expect, it } from "vitest";
import type { ChatMessageDto } from "@/lib/domain";
import {
  findLastUserMessageIndex,
  getPendingAssistantMessagesForTts,
  markAssistantMessageSkipped,
} from "@/lib/tts-playback-queue";

function message(
  id: string,
  role: "user" | "assistant",
  content = "",
): ChatMessageDto {
  return {
    id,
    role,
    kind: "message",
    content,
    metadata: null,
    createdAt: new Date().toISOString(),
  };
}

describe("findLastUserMessageIndex", () => {
  it("returns -1 when there are no user messages", () => {
    expect(findLastUserMessageIndex([message("a1", "assistant")])).toBe(-1);
  });

  it("returns the index of the latest user message", () => {
    const messages = [
      message("u1", "user"),
      message("a1", "assistant"),
      message("u2", "user"),
      message("a2", "assistant"),
    ];

    expect(findLastUserMessageIndex(messages)).toBe(2);
  });
});

describe("getPendingAssistantMessagesForTts", () => {
  it("speaks assistant messages when the thread starts with Riva", () => {
    const messages = [message("a1", "assistant", "Welcome")];

    expect(getPendingAssistantMessagesForTts(messages, null).map((entry) => entry.id)).toEqual(["a1"]);
  });

  it("only speaks assistant messages after the latest user message", () => {
    const messages = [
      message("u1", "user"),
      message("a1", "assistant", "Interrupted reply"),
      message("u2", "user"),
      message("a2", "assistant", "Latest reply"),
    ];

    expect(getPendingAssistantMessagesForTts(messages, null).map((entry) => entry.id)).toEqual(["a2"]);
  });

  it("does not replay an interrupted assistant message once a newer user turn exists", () => {
    const messages = [
      message("u1", "user"),
      message("a1", "assistant", "Interrupted reply"),
      message("u2", "user"),
      message("a2", "assistant", "Latest reply"),
    ];

    expect(getPendingAssistantMessagesForTts(messages, null).map((entry) => entry.id)).toEqual(["a2"]);
    expect(getPendingAssistantMessagesForTts(messages, "a1").map((entry) => entry.id)).toEqual(["a2"]);
  });

  it("plays chained assistant messages only within the active user turn", () => {
    const messages = [
      message("u1", "user"),
      message("a1", "assistant", "Intro"),
      message("a2", "assistant", "Prompt"),
    ];

    expect(getPendingAssistantMessagesForTts(messages, null).map((entry) => entry.id)).toEqual(["a1", "a2"]);
    expect(getPendingAssistantMessagesForTts(messages, "a1").map((entry) => entry.id)).toEqual(["a2"]);
  });

  it("skips assistant messages from earlier turns even if lastSpokenId is stale", () => {
    const messages = [
      message("u1", "user"),
      message("a1", "assistant", "Old reply"),
      message("u2", "user"),
      message("a2", "assistant", "New reply"),
    ];

    expect(getPendingAssistantMessagesForTts(messages, "a0").map((entry) => entry.id)).toEqual(["a2"]);
  });
});

describe("markAssistantMessageSkipped", () => {
  it("records the interrupted assistant message as spoken", () => {
    const messages = [message("u1", "user"), message("a1", "assistant")];

    expect(markAssistantMessageSkipped(messages, "a1", null)).toBe("a1");
  });

  it("does not move lastSpokenId backwards", () => {
    const messages = [
      message("u1", "user"),
      message("a1", "assistant"),
      message("a2", "assistant"),
    ];

    expect(markAssistantMessageSkipped(messages, "a1", "a2")).toBe("a2");
  });
});
