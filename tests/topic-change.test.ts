import { describe, expect, it } from "vitest";
import {
  detectTopicChangeIntent,
  TOPIC_CHANGE_ACK_WITH_TITLE,
  TOPIC_CHANGE_CLARIFY_MESSAGE,
} from "@/lib/topic-change";
import { topicChangeIntentSchema } from "@/lib/domain";

describe("detectTopicChangeIntent", () => {
  it("detects explicit change-topic requests without a new title", () => {
    const result = detectTopicChangeIntent("change topic", "Airport check-in");
    expect(result).toEqual({
      wantsChange: true,
      topicClear: false,
      newTopicTitle: null,
      confidence: "strong",
    });
  });

  it("detects Hinglish and vague something-else requests", () => {
    expect(detectTopicChangeIntent("topic badlo", "Office small talk").wantsChange).toBe(true);
    expect(detectTopicChangeIntent("kuch aur", "Office small talk").topicClear).toBe(false);
    expect(detectTopicChangeIntent("let's do something else", "Travel").wantsChange).toBe(true);
  });

  it("extracts a concrete replacement topic from common phrasings", () => {
    expect(detectTopicChangeIntent("I want to learn about restaurants instead", "Airport")).toMatchObject({
      wantsChange: true,
      topicClear: true,
      newTopicTitle: "restaurants",
      confidence: "strong",
    });

    expect(detectTopicChangeIntent("new topic: travel", "Airport")).toMatchObject({
      wantsChange: true,
      topicClear: true,
      newTopicTitle: "travel",
      confidence: "strong",
    });

    expect(detectTopicChangeIntent("let's practice interviews", "Airport")).toMatchObject({
      wantsChange: true,
      topicClear: true,
      newTopicTitle: "interviews",
    });

    expect(detectTopicChangeIntent("I practice speaking every day", "Airport").wantsChange).toBe(false);
  });

  it("treats soft learn-about requests as soft confidence for LLM confirmation", () => {
    const result = detectTopicChangeIntent("I want to learn about restaurants", "Airport check-in");
    expect(result.wantsChange).toBe(true);
    expect(result.topicClear).toBe(true);
    expect(result.newTopicTitle).toBe("restaurants");
    expect(result.confidence).toBe("soft");
  });

  it("does not treat normal lesson answers as topic changes", () => {
    expect(detectTopicChangeIntent("Good morning, here is my passport.", "Airport").wantsChange).toBe(
      false,
    );
    expect(detectTopicChangeIntent("I would like a window seat please", "Airport").confidence).toBe(
      "none",
    );
    expect(detectTopicChangeIntent("continue", "Airport").wantsChange).toBe(false);
    expect(detectTopicChangeIntent("ready", "Airport").wantsChange).toBe(false);
    expect(
      detectTopicChangeIntent("I want to learn about Airport check-in", "Airport check-in").wantsChange,
    ).toBe(false);
  });

  it("ignores extracted titles that match the current topic", () => {
    const result = detectTopicChangeIntent("change topic to Airport check-in", "Airport check-in");
    expect(result.wantsChange).toBe(true);
    expect(result.topicClear).toBe(false);
    expect(result.newTopicTitle).toBeNull();
  });
});

describe("topic change copy helpers", () => {
  it("keeps Hinglish acknowledgment and clarify messages", () => {
    expect(TOPIC_CHANGE_ACK_WITH_TITLE("restaurants")).toContain("restaurants");
    expect(TOPIC_CHANGE_CLARIFY_MESSAGE.toLowerCase()).toContain("topic");
  });
});

describe("topicChangeIntentSchema", () => {
  it("accepts classifier JSON shapes", () => {
    expect(
      topicChangeIntentSchema.parse({
        wants_topic_change: true,
        new_topic_title: "Travel",
        topic_clear: true,
        acknowledgment: "Theek hai, travel practice karte hain.",
      }),
    ).toMatchObject({ wants_topic_change: true, topic_clear: true });

    expect(
      topicChangeIntentSchema.parse({
        wants_topic_change: false,
      }),
    ).toMatchObject({ wants_topic_change: false, topic_clear: false });
  });
});
