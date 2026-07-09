import { describe, expect, it } from "vitest";
import {
  formatLanguageRulesForPrompt,
  getHinglishCompositionRule,
  isContinueAdvancePhrase,
  resolveHinglishCompositionBand,
  RIVA_GRAMMAR_RULE,
  RIVA_LANGUAGE_RULE,
  stripUiInstructions,
} from "@/lib/content";

describe("RIVA_LANGUAGE_RULE", () => {
  it("defines Hinglish-first language guidance", () => {
    expect(RIVA_LANGUAGE_RULE).toContain("Hinglish");
    expect(RIVA_LANGUAGE_RULE).toContain("expectedAnswer");
  });
});

describe("CEFR Hinglish composition", () => {
  it("maps levels to support_heavy, balanced, and english_leaning bands", () => {
    expect(resolveHinglishCompositionBand("A1")).toBe("support_heavy");
    expect(resolveHinglishCompositionBand("A2")).toBe("support_heavy");
    expect(resolveHinglishCompositionBand("B1")).toBe("balanced");
    expect(resolveHinglishCompositionBand("B2")).toBe("balanced");
    expect(resolveHinglishCompositionBand("C1")).toBe("english_leaning");
    expect(resolveHinglishCompositionBand("C2")).toBe("english_leaning");
  });

  it("defaults unknown or missing level to A2 support_heavy", () => {
    expect(resolveHinglishCompositionBand(null)).toBe("support_heavy");
    expect(resolveHinglishCompositionBand("")).toBe("support_heavy");
    expect(resolveHinglishCompositionBand("xyz")).toBe("support_heavy");
  });

  it("returns band-specific composition rules", () => {
    expect(getHinglishCompositionRule("A1")).toContain("support-heavy");
    expect(getHinglishCompositionRule("B1")).toContain("balanced");
    expect(getHinglishCompositionRule("C1")).toContain("English-leaning");
  });

  it("combines base language rule with CEFR mix in prompt helper", () => {
    const block = formatLanguageRulesForPrompt("B2");
    expect(block).toContain(RIVA_LANGUAGE_RULE);
    expect(block).toContain("balanced");
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
