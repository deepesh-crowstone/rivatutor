import { describe, expect, it, vi } from "vitest";
import {
  mapTopicChangeClassification,
  resolveTopicChangeFromClassifier,
} from "@/lib/topic-change-resolve";

describe("mapTopicChangeClassification", () => {
  it("maps LLM switch with a clear title", () => {
    expect(
      mapTopicChangeClassification({
        wants_topic_change: true,
        topic_clear: true,
        new_topic_title: "Travel conversations",
        acknowledgment: "Alright — let's practice travel conversations.",
      }),
    ).toEqual({
      wantsChange: true,
      topicClear: true,
      newTopicTitle: "Travel conversations",
      confidence: "llm",
    });
  });

  it("maps LLM decline to no change", () => {
    expect(
      mapTopicChangeClassification({
        wants_topic_change: false,
        topic_clear: false,
        new_topic_title: null,
      }),
    ).toEqual({
      wantsChange: false,
      topicClear: false,
      newTopicTitle: null,
      confidence: "none",
    });
  });
});

describe("resolveTopicChangeFromClassifier", () => {
  it("uses the LLM result as the primary decision", async () => {
    const classify = vi.fn(async () => ({
      wants_topic_change: true,
      topic_clear: true,
      new_topic_title: "travel conversations",
      acknowledgment: "Sure.",
    }));

    const result = await resolveTopicChangeFromClassifier({
      utterance: "i wanna practice travel conversations",
      currentTopicTitle: "Professional Intonation",
      classify,
    });

    expect(classify).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      wantsChange: true,
      topicClear: true,
      newTopicTitle: "travel conversations",
      confidence: "llm",
    });
  });

  it("falls back to heuristics only when the LLM classifier fails", async () => {
    const classify = vi.fn(async () => {
      throw new Error("OpenRouter unavailable");
    });

    const result = await resolveTopicChangeFromClassifier({
      utterance: "change topic",
      currentTopicTitle: "Professional Intonation",
      classify,
    });

    expect(classify).toHaveBeenCalledOnce();
    expect(result.wantsChange).toBe(true);
    expect(result.confidence).not.toBe("llm");
  });

  it("does not call heuristics when the LLM says stay on topic", async () => {
    const classify = vi.fn(async () => ({
      wants_topic_change: false,
      topic_clear: false,
      new_topic_title: null,
    }));

    const result = await resolveTopicChangeFromClassifier({
      utterance: "I would like a window seat please",
      currentTopicTitle: "Airport check-in",
      classify,
    });

    expect(result.wantsChange).toBe(false);
    expect(result.confidence).toBe("none");
  });
});
