import { describe, expect, it } from "vitest";
import { isContinueAdvancePhrase, RIVA_GRAMMAR_RULE, RIVA_LANGUAGE_RULE, stripUiInstructions } from "@/lib/content";

describe("RIVA_LANGUAGE_RULE", () => {
  it("defines Hinglish-first language guidance", () => {
    expect(RIVA_LANGUAGE_RULE).toContain("Hinglish");
    expect(RIVA_LANGUAGE_RULE).toContain("expectedAnswer");
  });
});

describe("RIVA_GRAMMAR_RULE", () => {
  it("requires grammar teaching on concept steps", () => {
    expect(RIVA_GRAMMAR_RULE).toContain("grammar");
    expect(RIVA_GRAMMAR_RULE).toContain("concept");
    expect(RIVA_GRAMMAR_RULE).toContain("CEFR");
  });

  it("forbids previewing SAR target sentences on concept steps", () => {
    expect(RIVA_GRAMMAR_RULE).toContain("Do NOT preview SAR target sentences");
  });
});

describe("stripUiInstructions", () => {
  it("removes tap continue phrasing", () => {
    expect(stripUiInstructions("Good work. Tap Continue when you are ready.")).toBe("Good work.");
    expect(stripUiInstructions("When you're ready, tap continue to move on.")).toBe("");
  });

  it("removes mic and choose-above phrasing", () => {
    expect(stripUiInstructions("Tap the mic when you want to answer.")).toBe("");
    expect(stripUiInstructions("Choose a level above to continue.")).toBe("");
    expect(stripUiInstructions("Choose one suggested topic above.")).toBe("");
  });

  it("removes jab aap ready ho batana from stored teaching text", () => {
    expect(stripUiInstructions("Chaliye samjhte hain. Jab aap ready ho, toh batana.")).toBe(
      "Chaliye samjhte hain.",
    );
  });
});

describe("isContinueAdvancePhrase", () => {
  it("recognizes common advance phrases", () => {
    expect(isContinueAdvancePhrase("continue")).toBe(true);
    expect(isContinueAdvancePhrase("Next.")).toBe(true);
    expect(isContinueAdvancePhrase("got it")).toBe(true);
  });

  it("rejects substantive answers", () => {
    expect(isContinueAdvancePhrase("I would like tea")).toBe(false);
  });
});
