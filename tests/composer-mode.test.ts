import { describe, expect, it } from "vitest";
import { deriveComposerState } from "@/lib/composer-mode";
import type { AppState } from "@/lib/domain";

function baseProfile(overrides: Partial<AppState["profile"]> = {}): AppState["profile"] {
  return {
    id: "learner-1",
    username: "dipesh",
    name: "Dipesh",
    selfDeclaredLevel: "A2",
    intentRaw: null,
    intentSummary: null,
    intentGoalContexts: [],
    intentMotivation: null,
    intentClarityStatus: "unknown",
    intentProbeCount: 0,
    userInterests: [],
    extractedKeyFacts: [],
    ...overrides,
  };
}

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    needsUsername: false,
    profile: baseProfile(),
    topics: [],
    activeTopic: null,
    currentStep: null,
    messages: [],
    missingApiKey: false,
    ...overrides,
  };
}

describe("deriveComposerState", () => {
  it("enables mic during name onboarding", () => {
    const result = deriveComposerState(
      baseState({
        profile: baseProfile({ name: null, selfDeclaredLevel: null }),
      }),
    );

    expect(result.composerMode).toBe("onboarding");
    expect(result.micDisabled).toBe(false);
  });

  it("disables mic during level selection", () => {
    const result = deriveComposerState(
      baseState({
        profile: baseProfile({ selfDeclaredLevel: null }),
      }),
    );

    expect(result.composerMode).toBe("onboarding");
    expect(result.micDisabled).toBe(true);
    expect(result.needsLevel).toBe(true);
  });

  it("shows intent mode after level capture even if profile pipeline prefilled intentSummary", () => {
    const result = deriveComposerState(
      baseState({
        profile: baseProfile({
          intentSummary: "Improve spoken English for work meetings",
          intentClarityStatus: "unknown",
        }),
      }),
    );

    expect(result.composerMode).toBe("intent");
    expect(result.micDisabled).toBe(false);
  });

  it("keeps intent mode while probing for clarity", () => {
    const result = deriveComposerState(
      baseState({
        profile: baseProfile({
          intentSummary: "Speak English at work",
          intentClarityStatus: "probing",
          intentProbeCount: 1,
        }),
      }),
    );

    expect(result.composerMode).toBe("intent");
    expect(result.micDisabled).toBe(false);
  });

  it("enables mic during topic selection", () => {
    const result = deriveComposerState(
      baseState({
        profile: baseProfile({
          intentSummary: "Speak confidently at work",
          intentClarityStatus: "clear",
        }),
        topics: [
          {
            id: "topic-1",
            title: "Office small talk",
            description: "Practice casual workplace chat",
            order: 1,
            status: "pending",
            source: "curriculum",
          },
        ],
      }),
    );

    expect(result.composerMode).toBe("topic");
    expect(result.micDisabled).toBe(false);
  });

  it("blocks composer after intent is captured but before topics exist", () => {
    const result = deriveComposerState(
      baseState({
        profile: baseProfile({
          intentSummary: "Speak confidently at work",
          intentClarityStatus: "clear",
        }),
      }),
    );

    expect(result.composerMode).toBe("blocked");
  });

  it("uses lesson mode for active SAR question steps", () => {
    const result = deriveComposerState(
      baseState({
        profile: baseProfile({
          intentSummary: "Speak confidently at work",
          intentClarityStatus: "clear",
        }),
        topics: [
          {
            id: "topic-1",
            title: "Office small talk",
            description: "Practice casual workplace chat",
            order: 1,
            status: "active",
            source: "curriculum",
          },
        ],
        activeTopic: {
          id: "topic-1",
          title: "Office small talk",
          description: "Practice casual workplace chat",
          order: 1,
          status: "active",
          source: "curriculum",
        },
        currentStep: {
          id: "step-1",
          order: 1,
          type: "question",
          questionType: "sar",
          content: "Repeat after me: I would like tea.",
          expectedAnswer: "I would like tea.",
          completed: false,
        },
      }),
    );

    expect(result.composerMode).toBe("lesson");
  });

  it("blocks composer during concept steps", () => {
    const result = deriveComposerState(
      baseState({
        profile: baseProfile({
          intentSummary: "Speak confidently at work",
          intentClarityStatus: "clear",
        }),
        topics: [
          {
            id: "topic-1",
            title: "Office small talk",
            description: "Practice casual workplace chat",
            order: 1,
            status: "active",
            source: "curriculum",
          },
        ],
        activeTopic: {
          id: "topic-1",
          title: "Office small talk",
          description: "Practice casual workplace chat",
          order: 1,
          status: "active",
          source: "curriculum",
        },
        currentStep: {
          id: "step-1",
          order: 1,
          type: "concept",
          questionType: null,
          content: "Let's learn a greeting.",
          expectedAnswer: null,
          completed: false,
        },
      }),
    );

    expect(result.composerMode).toBe("blocked");
  });

  it("blocks composer during practice steps", () => {
    const result = deriveComposerState(
      baseState({
        profile: baseProfile({
          intentSummary: "Speak confidently at work",
          intentClarityStatus: "clear",
        }),
        topics: [
          {
            id: "topic-1",
            title: "Office small talk",
            description: "Practice casual workplace chat",
            order: 1,
            status: "active",
            source: "curriculum",
          },
        ],
        activeTopic: {
          id: "topic-1",
          title: "Office small talk",
          description: "Practice casual workplace chat",
          order: 1,
          status: "active",
          source: "curriculum",
        },
        currentStep: {
          id: "step-2",
          order: 2,
          type: "practice",
          questionType: null,
          content: "Let's practice a greeting.",
          expectedAnswer: null,
          completed: false,
        },
      }),
    );

    expect(result.composerMode).toBe("blocked");
  });
});
