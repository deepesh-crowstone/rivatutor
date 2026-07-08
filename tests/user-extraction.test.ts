import { describe, expect, it } from "vitest";
import { profileUpdateResultSchema, userInfoExtractionSchema } from "@/lib/domain";
import { mergeProfileUpdate } from "@/lib/profile-pipeline";
import {
  buildLearnerContextBlock,
  extractNameFallback,
  isInvalidExtractedName,
  mergeExtractedArrays,
} from "@/lib/user-extraction";

describe("isInvalidExtractedName", () => {
  it("rejects incomplete intro phrases without a name", () => {
    expect(isInvalidExtractedName("My name is")).toBe(true);
    expect(isInvalidExtractedName("I am")).toBe(true);
    expect(isInvalidExtractedName("I'm")).toBe(true);
    expect(isInvalidExtractedName("Call me")).toBe(true);
    expect(isInvalidExtractedName("")).toBe(true);
    expect(isInvalidExtractedName("   ")).toBe(true);
  });

  it("accepts real names", () => {
    expect(isInvalidExtractedName("Dipesh")).toBe(false);
    expect(isInvalidExtractedName("John Smith")).toBe(false);
  });
});

describe("extractNameFallback", () => {
  it("extracts a single name from common intro phrases", () => {
    expect(extractNameFallback("Hi, my name is Dipesh")).toBe("Dipesh");
    expect(extractNameFallback("My name is Dipesh")).toBe("Dipesh");
    expect(extractNameFallback("I'm Dipesh")).toBe("Dipesh");
    expect(extractNameFallback("I am Dipesh")).toBe("Dipesh");
  });

  it("supports multi-word names", () => {
    expect(extractNameFallback("My name is John Smith")).toBe("John Smith");
  });

  it("returns null when no name pattern matches", () => {
    expect(extractNameFallback("My name is")).toBeNull();
    expect(extractNameFallback("Hello there")).toBeNull();
    expect(extractNameFallback("")).toBeNull();
  });
});

describe("userInfoExtractionSchema", () => {
  it("parses name extraction with name_provided false", () => {
    const parsed = userInfoExtractionSchema.parse({
      name: null,
      name_provided: false,
      follow_up_question: "What should I call you?",
      interests: [],
      key_facts: [],
    });

    expect(parsed.name_provided).toBe(false);
    expect(parsed.name).toBeNull();
    expect(parsed.follow_up_question).toBe("What should I call you?");
  });

  it("parses a full extraction payload", () => {
    const parsed = userInfoExtractionSchema.parse({
      name: "Dipesh",
      name_provided: true,
      level: "A2",
      interests: ["travel", "interviews"],
      key_facts: ["Works in tech"],
      confidence: 0.92,
    });

    expect(parsed).toEqual({
      name: "Dipesh",
      name_provided: true,
      level: "A2",
      interests: ["travel", "interviews"],
      key_facts: ["Works in tech"],
      confidence: 0.92,
    });
  });

  it("defaults list fields and rejects invalid levels", () => {
    expect(userInfoExtractionSchema.parse({})).toEqual({
      interests: [],
      key_facts: [],
    });

    expect(() => userInfoExtractionSchema.parse({ level: "Z9" })).toThrow();
  });
});

describe("mergeExtractedArrays", () => {
  it("deduplicates case-insensitively while preserving order", () => {
    expect(mergeExtractedArrays(["Travel"], ["travel", "Food"])).toEqual(["Travel", "Food"]);
  });
});

describe("buildLearnerContextBlock", () => {
  it("formats structured learner context for prompts", () => {
    const block = buildLearnerContextBlock({
      name: "Dipesh",
      selfDeclaredLevel: "A2",
      userInterests: ["travel"],
      extractedKeyFacts: ["Lives in Mumbai"],
    });

    expect(block).toContain("Learner name: Dipesh");
    expect(block).toContain("Level: A2");
    expect(block).toContain("Interests: travel");
    expect(block).toContain("Key facts: Lives in Mumbai");
  });
});

describe("mergeProfileUpdate", () => {
  it("merges interests and key facts without dropping existing data", () => {
    const merged = mergeProfileUpdate(
      {
        name: "Dipesh",
        userInterests: ["travel"],
        extractedKeyFacts: ["Works in tech"],
        intentSummary: "Improve interview English",
      },
      profileUpdateResultSchema.parse({
        interests: ["food", "travel"],
        key_facts: ["Lives in Mumbai"],
      }),
    );

    expect(merged.userInterests).toEqual(["travel", "food"]);
    expect(merged.extractedKeyFacts).toEqual(["Works in tech", "Lives in Mumbai"]);
    expect(merged.name).toBe("Dipesh");
    expect(merged.intentSummary).toBe("Improve interview English");
  });

  it("does not overwrite a valid name with null or invalid phrases", () => {
    const merged = mergeProfileUpdate(
      {
        name: "Dipesh",
        userInterests: [],
        extractedKeyFacts: [],
        intentSummary: null,
      },
      profileUpdateResultSchema.parse({
        interests: [],
        key_facts: [],
        name: null,
      }),
    );

    expect(merged.name).toBe("Dipesh");

    const invalid = mergeProfileUpdate(
      {
        name: "Dipesh",
        userInterests: [],
        extractedKeyFacts: [],
        intentSummary: null,
      },
      profileUpdateResultSchema.parse({
        interests: [],
        key_facts: [],
        name: "My name is",
      }),
    );

    expect(invalid.name).toBe("Dipesh");
  });

  it("updates name when a valid correction is provided", () => {
    const merged = mergeProfileUpdate(
      {
        name: null,
        userInterests: [],
        extractedKeyFacts: [],
        intentSummary: null,
      },
      profileUpdateResultSchema.parse({
        interests: [],
        key_facts: [],
        name: "Deepesh",
      }),
    );

    expect(merged.name).toBe("Deepesh");
  });
});
