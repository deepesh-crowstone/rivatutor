import { describe, expect, it } from "vitest";
import {
  fallbackOpenEndedAdvance,
  intentQuestionAfterLevel,
  loadingLabel,
  topicChangeAckWithTitle,
  topicChangeClarifyMessage,
  topicCompleteMessage,
  topicSuggestionMessage,
  topicSuggestionsUiLabel,
} from "@/lib/cefr-copy";

describe("cefr-copy topic suggestion", () => {
  it("uses English-leaning copy for C1/C2", () => {
    const message = topicSuggestionMessage("C1");
    expect(message).toContain("personalized topic sequence");
    expect(message).toContain("Pick a topic below");
    expect(message.toLowerCase()).not.toContain("bahut badhiya");
    expect(topicSuggestionsUiLabel("C1")).toContain("Pick a topic below");
  });

  it("keeps support-heavy Hinglish for A1/A2", () => {
    expect(topicSuggestionMessage("A2")).toContain("Bahut badhiya");
    expect(topicSuggestionsUiLabel("A1")).toContain("Neeche se topic");
  });

  it("uses balanced mix for B1/B2", () => {
    const message = topicSuggestionMessage("B1");
    expect(message).toContain("Great!");
    expect(message).toContain("Neeche se topic");
  });
});

describe("cefr-copy other hardcoded flows", () => {
  it("adapts intent question after level", () => {
    expect(intentQuestionAfterLevel("C1")).toContain("why do you want");
    expect(intentQuestionAfterLevel("A2")).toContain("Bahut badhiya");
  });

  it("adapts topic change and complete messages", () => {
    expect(topicChangeClarifyMessage("C2")).toContain("switch topics");
    expect(topicChangeAckWithTitle("Travel", "C1")).toContain("Travel");
    expect(topicChangeAckWithTitle("Travel", "C1")).toContain("Alright");
    expect(topicCompleteMessage("C1")).toContain("That topic's done");
    expect(topicCompleteMessage("A1")).toContain("Topic complete ho gaya");
  });

  it("uses English-only loading and fallback copy for C1–C2", () => {
    expect(loadingLabel("lessonPlan", "C1")).toBe("Building your lesson plan...");
    expect(loadingLabel("thinking", "C2")).toBe("Riva is thinking...");
    expect(loadingLabel("lessonPlan", "A2")).toContain("ban raha");
    expect(fallbackOpenEndedAdvance("C1")).toBe("Nice answer — let's keep going.");
    expect(fallbackOpenEndedAdvance("A2")).toContain("Achha jawab");
  });
});
