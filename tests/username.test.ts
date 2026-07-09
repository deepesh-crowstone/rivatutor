import { describe, expect, it } from "vitest";
import { buildWelcomeBackMessage } from "@/lib/username";
import { normalizeUsername, parseUsernameInput } from "@/lib/username-rules";

describe("normalizeUsername", () => {
  it("lowercases and trims", () => {
    expect(normalizeUsername("  Dipesh  ")).toBe("dipesh");
    expect(normalizeUsername("ALICE")).toBe("alice");
  });
});

describe("parseUsernameInput", () => {
  it("accepts plain usernames", () => {
    expect(parseUsernameInput("dipesh")).toBe("dipesh");
    expect(parseUsernameInput("Dipesh")).toBe("dipesh");
    expect(parseUsernameInput("user_42")).toBe("user_42");
  });

  it("extracts username from spoken phrases", () => {
    expect(parseUsernameInput("My username is dipesh")).toBe("dipesh");
    expect(parseUsernameInput("Use alice")).toBe("alice");
    expect(parseUsernameInput("@bob")).toBe("bob");
  });

  it("rejects invalid usernames", () => {
    expect(() => parseUsernameInput("")).toThrow("Please tell Riva a username.");
    expect(() => parseUsernameInput("a")).toThrow("at least 2 characters");
    expect(() => parseUsernameInput("bad name!")).toThrow("Use 2–32 lowercase");
  });
});

describe("buildWelcomeBackMessage", () => {
  it("summarizes stored profile context with CEFR-banded copy", () => {
    const a2 = buildWelcomeBackMessage({
      name: "Deepesh",
      username: "dipesh",
      selfDeclaredLevel: "A2",
      intentSummary: "Speak confidently at work",
      userInterests: '["travel","movies"]',
      extractedKeyFacts: '["Works in tech"]',
    });
    expect(a2).toContain("Wapas aaye aap, Deepesh!");
    expect(a2).toContain("level A2");
    expect(a2).toContain("Speak confidently at work");

    const c1 = buildWelcomeBackMessage({
      name: "Deepesh",
      username: "dipesh",
      selfDeclaredLevel: "C1",
      intentSummary: "Speak confidently at work",
      userInterests: '["travel","movies"]',
      extractedKeyFacts: '["Works in tech"]',
    });
    expect(c1).toContain("Welcome back, Deepesh!");
    expect(c1).toContain("You're at C1");
    expect(c1).toContain("travel");
    expect(c1).toContain("Works in tech");
  });

  it("falls back to username when name is missing", () => {
    const message = buildWelcomeBackMessage({
      name: null,
      username: "dipesh",
      selfDeclaredLevel: null,
      intentSummary: null,
      userInterests: "[]",
      extractedKeyFacts: "[]",
    });

    expect(message).toContain("Wapas aaye aap, dipesh!");
  });
});
