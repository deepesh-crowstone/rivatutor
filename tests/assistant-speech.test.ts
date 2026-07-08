import { describe, expect, it } from "vitest";
import { SAR_QUESTION_PROMPT } from "@/lib/content";
import { buildAssistantSpeechSegments, stripReadyBoliyeFromSpeech } from "@/lib/assistant-speech";

describe("stripReadyBoliyeFromSpeech", () => {
  it("removes ready gate phrases from spoken text", () => {
    expect(
      stripReadyBoliyeFromSpeech(
        "Chaliye practice karte hain. Aage badhne ke liye 'ready' boliye.",
      ),
    ).toBe("Chaliye practice karte hain.");
  });

  it("removes jab aap ready ho batana phrasing", () => {
    expect(
      stripReadyBoliyeFromSpeech(
        "Chaliye practice karte hain. Jab aap ready ho, toh batana.",
      ),
    ).toBe("Chaliye practice karte hain.");
  });
});

describe("buildAssistantSpeechSegments", () => {
  it("speaks Hinglish intro, SAR card prompt, then expectedAnswer", () => {
    expect(
      buildAssistantSpeechSegments({
        kind: "question",
        content: "Chalo ek useful phrase practice karte hain.",
        metadata: {
          questionType: "sar",
          questionPrompt: SAR_QUESTION_PROMPT,
          expectedAnswer: "Good morning, here is my passport.",
        },
      }),
    ).toEqual([
      "Chalo ek useful phrase practice karte hain.",
      SAR_QUESTION_PROMPT,
      "Good morning, here is my passport.",
    ]);
  });

  it("falls back to the standard SAR prompt when questionPrompt is missing", () => {
    expect(
      buildAssistantSpeechSegments({
        kind: "question",
        content: "",
        metadata: {
          questionType: "sar",
          expectedAnswer: "Good morning, here is my passport.",
        },
      }),
    ).toEqual([SAR_QUESTION_PROMPT, "Good morning, here is my passport."]);
  });

  it("speaks Hinglish intro then open-ended question prompt", () => {
    expect(
      buildAssistantSpeechSegments({
        kind: "question",
        content: "Ab apni situation mein socho.",
        metadata: {
          questionType: "open_ended",
          questionPrompt: "Socho agar tumhe apne friend ko greet karna ho — mic dabao aur batao.",
        },
      }),
    ).toEqual([
      "Ab apni situation mein socho.",
      "Socho agar tumhe apne friend ko greet karna ho — mic dabao aur batao.",
    ]);
  });

  it("strips ready boliye from non-SAR assistant messages", () => {
    expect(
      buildAssistantSpeechSegments({
        kind: "concept",
        content: "Airport par baat karte hain. Aage badhne ke liye 'ready' boliye.",
      }),
    ).toEqual(["Airport par baat karte hain."]);
  });
});
