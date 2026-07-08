import { describe, expect, it } from "vitest";
import { alignExpectedWords, diffTranscript, isSarPassingScore, SAR_PASS_THRESHOLD, tokenizeExpectedWords } from "@/lib/word-diff";

describe("diffTranscript", () => {
  it("marks exact spoken words as correct", () => {
    const result = diffTranscript("I would like to join the meeting", "I would like to join the meeting");

    expect(result.score).toBe(100);
    expect(result.tokens.every((token) => token.status === "correct")).toBe(true);
  });

  it("handles missing and extra words with stable scoring", () => {
    const result = diffTranscript("I would like to join the meeting", "I like to join meeting today");

    expect(result.score).toBe(71);
    expect(result.tokens.map((token) => token.status)).toContain("missing");
    expect(result.tokens.map((token) => token.status)).toContain("extra");
  });

  it("normalizes punctuation and casing", () => {
    const result = diffTranscript("Good morning, everyone.", "good morning everyone");

    expect(result.score).toBe(100);
  });
});

describe("alignExpectedWords", () => {
  it("marks every expected word as correct on an exact match", () => {
    const tokens = alignExpectedWords("I would like tea", "I would like tea");

    expect(tokens).toEqual([
      { word: "I", status: "correct" },
      { word: "would", status: "correct" },
      { word: "like", status: "correct" },
      { word: "tea", status: "correct" },
    ]);
  });

  it("maps substitutions and omissions to incorrect or missing", () => {
    const tokens = alignExpectedWords("I would like to join the meeting", "I like to join meeting today");

    expect(tokens.map((token) => token.status)).toContain("incorrect");
    expect(tokens.map((token) => token.status)).toContain("missing");
    expect(tokens.every((token) => token.status !== "extra")).toBe(true);
    expect(tokens).toHaveLength(7);
  });

  it("returns pending tokens before grading", () => {
    expect(tokenizeExpectedWords("Good morning everyone")).toEqual([
      { word: "Good", status: "pending" },
      { word: "morning", status: "pending" },
      { word: "everyone", status: "pending" },
    ]);
  });
});

describe("isSarPassingScore", () => {
  it("uses the 80% threshold", () => {
    expect(SAR_PASS_THRESHOLD).toBe(80);
    expect(isSarPassingScore(80)).toBe(true);
    expect(isSarPassingScore(79)).toBe(false);
  });
});
