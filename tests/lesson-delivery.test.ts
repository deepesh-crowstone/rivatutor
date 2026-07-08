import { describe, expect, it } from "vitest";
import { lessonDeliverySchema } from "@/lib/domain";
import {
  buildFallbackLessonDelivery,
  contentOverlapsExpectedAnswer,
  extractGrammarTeachingLines,
  formatLessonPlanForPrompt,
  formatRecentConversation,
  resolveAssistantMessageKind,
  resolveDeliverableStep,
  resolveStepIntroAssistantKind,
  sanitizeQuestionStepIntroReply,
  shouldAdvanceAfterDelivery,
  shouldChainStepIntro,
  shouldCreateSarRetryQuestionCard,
  shouldPersistLessonAnswerUserMessage,
  shouldSkipStepIntro,
  stripOpenEndedAnswerCues,
  stripOpenEndedScenarioPatterns,
  stripQuestionPromptFromSpokenReply,
  sanitizeOpenEndedStepIntroReply,
  sentenceSharesTopicWithPrompt,
  textsOverlapSubstantially,
  trimToFirstShortSentence,
} from "@/lib/lesson-delivery";

describe("lessonDeliverySchema", () => {
  it("accepts a valid delivery payload", () => {
    const parsed = lessonDeliverySchema.parse({
      spoken_reply: "Let's try that sentence together.",
      advance_step: false,
      reteach_current_step: false,
    });

    expect(parsed.spoken_reply).toContain("sentence");
  });

  it("defaults reteach_current_step to false", () => {
    const parsed = lessonDeliverySchema.parse({
      spoken_reply: "Nice work.",
      advance_step: true,
    });

    expect(parsed.reteach_current_step).toBe(false);
  });
});

describe("formatLessonPlanForPrompt", () => {
  it("serializes plan steps for the deliverer prompt", () => {
    const formatted = formatLessonPlanForPrompt([
      {
        order: 1,
        type: "concept",
        content: "Introduce ordering coffee.",
      },
      {
        order: 2,
        type: "question",
        questionType: "sar",
        content: "Repeat after me: I would like a coffee.",
        expectedAnswer: "I would like a coffee.",
      },
    ]);

    expect(formatted).toContain('"questionType": "sar"');
    expect(formatted).toContain("I would like a coffee.");
  });
});

describe("formatRecentConversation", () => {
  it("formats the last N messages", () => {
    const formatted = formatRecentConversation(
      [
        { role: "assistant", content: "Repeat after me." },
        { role: "user", content: "I would like tea." },
        { role: "assistant", content: "Good try." },
      ],
      2,
    );

    expect(formatted).toBe("user: I would like tea.\nassistant: Good try.");
  });
});

describe("resolveAssistantMessageKind", () => {
  it("uses step type for introductions", () => {
    expect(resolveAssistantMessageKind({ type: "concept", questionType: null }, "step_intro")).toBe("concept");
  });

  it("uses sar_feedback for SAR responses", () => {
    expect(
      resolveAssistantMessageKind({ type: "question", questionType: "sar" }, "learner_response"),
    ).toBe("sar_feedback");
  });

  it("uses feedback for open-ended responses", () => {
    expect(
      resolveAssistantMessageKind({ type: "question", questionType: "open_ended" }, "learner_response"),
    ).toBe("feedback");
  });
});

describe("shouldPersistLessonAnswerUserMessage", () => {
  it("skips SAR user messages", () => {
    expect(
      shouldPersistLessonAnswerUserMessage({ type: "question", questionType: "sar" }),
    ).toBe(false);
  });

  it("persists open-ended user messages", () => {
    expect(
      shouldPersistLessonAnswerUserMessage({ type: "question", questionType: "open_ended" }),
    ).toBe(true);
  });

  it("persists concept and practice user messages", () => {
    expect(shouldPersistLessonAnswerUserMessage({ type: "concept", questionType: null })).toBe(true);
    expect(shouldPersistLessonAnswerUserMessage({ type: "practice", questionType: null })).toBe(true);
  });
});

describe("shouldCreateSarRetryQuestionCard", () => {
  it("creates a retry card when SAR reteach is requested", () => {
    expect(
      shouldCreateSarRetryQuestionCard(
        { reteach_current_step: true },
        { type: "question", questionType: "sar" },
      ),
    ).toBe(true);
  });

  it("does not create a retry card when SAR passes", () => {
    expect(
      shouldCreateSarRetryQuestionCard(
        { reteach_current_step: false },
        { type: "question", questionType: "sar" },
      ),
    ).toBe(false);
  });
});

describe("contentOverlapsExpectedAnswer", () => {
  it("detects when concept content previews a SAR sentence", () => {
    expect(
      contentOverlapsExpectedAnswer(
        "Aap keh sakte hain: Good morning, here is my passport.",
        "Good morning, here is my passport.",
      ),
    ).toBe(true);
  });

  it("does not flag unrelated Hinglish concept copy", () => {
    expect(
      contentOverlapsExpectedAnswer(
        "Airport par immigration desk par aap apna passport dikhate hain.",
        "Good morning, here is my passport.",
      ),
    ).toBe(false);
  });
});

describe("shouldSkipStepIntro", () => {
  it("skips concept steps that duplicate the next SAR target", () => {
    expect(
      shouldSkipStepIntro(
        {
          type: "concept",
          content: "Aap keh sakte hain: Good morning, here is my passport.",
        },
        {
          type: "question",
          questionType: "sar",
          content: "Ye sentence repeat kijiye: Good morning, here is my passport.",
          expectedAnswer: "Good morning, here is my passport.",
        },
      ),
    ).toBe(true);
  });

  it("keeps concept steps that only set context in Hinglish", () => {
    expect(
      shouldSkipStepIntro(
        {
          type: "concept",
          content: "Airport par immigration officer se politely baat karte hain.",
        },
        {
          type: "question",
          questionType: "sar",
          content: "Ye sentence repeat kijiye: Good morning, here is my passport.",
          expectedAnswer: "Good morning, here is my passport.",
        },
      ),
    ).toBe(false);
  });

  it("keeps practice bridge steps that do not duplicate the next SAR target", () => {
    expect(
      shouldSkipStepIntro(
        {
          type: "practice",
          content: "Chaliye ab hum airport greeting practice karte hain.",
        },
        {
          type: "question",
          questionType: "sar",
          content: "Ye sentence repeat kijiye: Good morning, here is my passport.",
          expectedAnswer: "Good morning, here is my passport.",
        },
      ),
    ).toBe(false);
  });

  it("skips practice steps that duplicate the next SAR target", () => {
    expect(
      shouldSkipStepIntro(
        {
          type: "practice",
          content: "Aap keh sakte hain: Good morning, here is my passport.",
        },
        {
          type: "question",
          questionType: "sar",
          content: "Ye sentence repeat kijiye: Good morning, here is my passport.",
          expectedAnswer: "Good morning, here is my passport.",
        },
      ),
    ).toBe(true);
  });
});

describe("resolveDeliverableStep", () => {
  it("skips duplicate concept and lands on SAR", () => {
    const steps = [
      {
        order: 1,
        type: "concept" as const,
        content: "Repeat: Good morning, here is my passport.",
      },
      {
        order: 2,
        type: "question" as const,
        questionType: "sar" as const,
        content: "Ye sentence repeat kijiye: Good morning, here is my passport.",
        expectedAnswer: "Good morning, here is my passport.",
      },
    ];

    const resolved = resolveDeliverableStep(steps, 1);
    expect(resolved.skippedOrders).toEqual([1]);
    expect(resolved.step.order).toBe(2);
  });

  it("keeps practice bridge and lands on SAR only when practice duplicates target", () => {
    const steps = [
      {
        order: 1,
        type: "concept" as const,
        content: "Airport par immigration officer se politely baat karte hain.",
      },
      {
        order: 2,
        type: "practice" as const,
        content: "Chaliye ab hum greeting practice karte hain.",
      },
      {
        order: 3,
        type: "question" as const,
        questionType: "sar" as const,
        content: "Ye sentence repeat kijiye: Good morning, here is my passport.",
        expectedAnswer: "Good morning, here is my passport.",
      },
    ];

    const resolved = resolveDeliverableStep(steps, 2);
    expect(resolved.skippedOrders).toEqual([]);
    expect(resolved.step.order).toBe(2);
  });
});

describe("resolveStepIntroAssistantKind", () => {
  it("uses question kind for SAR intros so the card renders immediately", () => {
    expect(resolveStepIntroAssistantKind({ type: "question" })).toBe("question");
    expect(resolveStepIntroAssistantKind({ type: "concept" })).toBe("concept");
  });
});

describe("shouldChainStepIntro", () => {
  it("chains concept, practice, and recap intros automatically", () => {
    expect(shouldChainStepIntro({ type: "concept" })).toBe(true);
    expect(shouldChainStepIntro({ type: "practice" })).toBe(true);
    expect(shouldChainStepIntro({ type: "recap" })).toBe(true);
  });

  it("stops chaining on question intros", () => {
    expect(shouldChainStepIntro({ type: "question" })).toBe(false);
  });
});

describe("extractGrammarTeachingLines", () => {
  it("pulls Hinglish grammar sentences from step content", () => {
    const lines = extractGrammarTeachingLines(
      "Airport par check-in karte hain. English mein 'here is' ka matlab hota hai 'yeh hai' — pehle subject, phir verb.",
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("ka matlab");
    expect(lines[0]).toContain("subject");
  });

  it("returns empty when no grammar teaching is present", () => {
    expect(
      extractGrammarTeachingLines("Airport par immigration officer se politely baat karte hain."),
    ).toEqual([]);
  });
});

describe("buildFallbackLessonDelivery", () => {
  it("preserves grammar hints when English preview is stripped from concept fallback", () => {
    const delivery = buildFallbackLessonDelivery({
      step: {
        order: 1,
        type: "concept",
        content:
          "Aap keh sakte hain: Good morning, here is my passport. English mein 'here is' ka matlab hota hai 'yeh hai' — pehle subject, phir verb.",
      },
      turnKind: "step_intro",
      nextStep: { type: "question" },
    });

    expect(delivery.spoken_reply).not.toContain("Good morning, here is my passport.");
    expect(delivery.spoken_reply).toContain("ka matlab");
    expect(delivery.advance_step).toBe(true);
  });

  it("auto-advances concept step intro without ready CTA", () => {
    const delivery = buildFallbackLessonDelivery({
      step: {
        order: 1,
        type: "concept",
        content: "Airport par aap keh sakte hain: Good morning, here is my passport.",
      },
      turnKind: "step_intro",
      nextStep: { type: "practice" },
    });

    expect(delivery.spoken_reply).not.toContain("Good morning, here is my passport.");
    expect(delivery.spoken_reply).not.toMatch(/ready|batana|continue/i);
    expect(delivery.advance_step).toBe(true);
  });

  it("auto-advances concept step intro without English preview", () => {
    const delivery = buildFallbackLessonDelivery({
      step: {
        order: 1,
        type: "concept",
        content: "Chaliye samjhte hain drinks order karte waqt kaise baat karni hai.",
      },
      turnKind: "step_intro",
      nextStep: { type: "practice" },
    });

    expect(delivery.spoken_reply).toContain("drinks order karte waqt");
    expect(delivery.spoken_reply).not.toMatch(/ready|batana|continue/i);
    expect(delivery.advance_step).toBe(true);
  });

  it("never includes ready, batana, or continue in any step intro fallback", () => {
    const steps = [
      {
        order: 1,
        type: "concept" as const,
        content: "Airport par immigration officer se politely baat karte hain.",
      },
      {
        order: 2,
        type: "practice" as const,
        content: "Chaliye ab hum greeting practice karte hain.",
      },
      {
        order: 3,
        type: "question" as const,
        questionType: "sar" as const,
        content: "Ye sentence repeat kijiye: Good morning, here is my passport.",
        expectedAnswer: "Good morning, here is my passport.",
      },
      {
        order: 4,
        type: "question" as const,
        questionType: "open_ended" as const,
        content: "How do you usually order drinks?",
      },
      {
        order: 5,
        type: "recap" as const,
        content: "Today you practiced ordering drinks.",
      },
    ];

    for (const step of steps) {
      const delivery = buildFallbackLessonDelivery({
        step,
        turnKind: "step_intro",
        nextStep: steps.find((candidate) => candidate.order === step.order + 1) ?? null,
      });

      expect(delivery.spoken_reply).not.toMatch(/ready|batana|continue/i);
    }

    expect(shouldChainStepIntro({ type: "concept" })).toBe(true);
    expect(shouldChainStepIntro({ type: "practice" })).toBe(true);
    expect(shouldChainStepIntro({ type: "question" })).toBe(false);
    expect(shouldChainStepIntro({ type: "recap" })).toBe(true);

    const resolved = resolveDeliverableStep(steps, 1);
    expect(resolved.step.order).toBe(1);
    expect(shouldChainStepIntro(resolved.step)).toBe(true);
  });

  it("auto-advances practice step intro without ready CTA", () => {
    const delivery = buildFallbackLessonDelivery({
      step: {
        order: 2,
        type: "practice",
        content: "Listen: I would like a coffee.",
      },
      turnKind: "step_intro",
      nextStep: { type: "recap" },
    });

    expect(delivery.spoken_reply).not.toMatch(/ready|batana|continue/i);
    expect(delivery.spoken_reply).not.toContain("I would like a coffee.");
    expect(delivery.advance_step).toBe(true);
  });

  it("does not embed the SAR sentence or a ready gate on step intro", () => {
    const delivery = buildFallbackLessonDelivery({
      step: {
        order: 3,
        type: "question",
        questionType: "sar",
        content: "Let's practice ordering.",
        expectedAnswer: "I would like tea.",
      },
      turnKind: "step_intro",
    });

    expect(delivery.spoken_reply).not.toContain("I would like tea.");
    expect(delivery.spoken_reply).not.toMatch(/repeat karein/i);
    expect(delivery.spoken_reply).not.toMatch(/ready boliye/i);
  });

  it("does not embed the open-ended question or a ready gate on step intro", () => {
    const delivery = buildFallbackLessonDelivery({
      step: {
        order: 4,
        type: "question",
        questionType: "open_ended",
        content: "How do you usually order drinks?",
      },
      turnKind: "step_intro",
    });

    expect(delivery.spoken_reply).not.toContain("How do you usually order drinks?");
    expect(delivery.spoken_reply).not.toMatch(/jawab bataiye/i);
    expect(delivery.spoken_reply).not.toMatch(/ready boliye/i);
    expect(delivery.spoken_reply).toBe("Chaliye ab real life mein try karte hain.");
  });

  it("does not append a CTA on recap step intro", () => {
    const delivery = buildFallbackLessonDelivery({
      step: {
        order: 5,
        type: "recap",
        content: "Today you practiced ordering drinks.",
      },
      turnKind: "step_intro",
    });

    expect(delivery.spoken_reply).toBe("Today you practiced ordering drinks.");
    expect(delivery.advance_step).toBe(true);
  });

  it("retries SAR when score is below threshold without restating the sentence", () => {
    const delivery = buildFallbackLessonDelivery({
      step: {
        order: 2,
        type: "question",
        questionType: "sar",
        content: "Repeat after me: I would like tea.",
        expectedAnswer: "I would like tea.",
      },
      turnKind: "learner_response",
      sarGrading: {
        score: 40,
        correctCount: 2,
        expectedCount: 5,
        expectedAnswer: "I would like tea.",
      },
    });

    expect(delivery.advance_step).toBe(false);
    expect(delivery.reteach_current_step).toBe(true);
    expect(delivery.spoken_reply).toContain("2 mein se 5");
    expect(delivery.spoken_reply).not.toContain("I would like tea.");
    expect(shouldCreateSarRetryQuestionCard(delivery, { type: "question", questionType: "sar" })).toBe(
      true,
    );
  });

  it("advances SAR when score meets threshold", () => {
    const delivery = buildFallbackLessonDelivery({
      step: {
        order: 2,
        type: "question",
        questionType: "sar",
        content: "Repeat after me: I would like tea.",
        expectedAnswer: "I would like tea.",
      },
      turnKind: "learner_response",
      sarGrading: {
        score: 90,
        correctCount: 5,
        expectedCount: 5,
        expectedAnswer: "I would like tea.",
      },
    });

    expect(delivery.advance_step).toBe(true);
    expect(delivery.reteach_current_step).toBe(false);
    expect(shouldCreateSarRetryQuestionCard(delivery, { type: "question", questionType: "sar" })).toBe(
      false,
    );
  });

  it("treats 80% as passing", () => {
    const delivery = buildFallbackLessonDelivery({
      step: {
        order: 2,
        type: "question",
        questionType: "sar",
        content: "Repeat after me: one two three four five.",
        expectedAnswer: "one two three four five.",
      },
      turnKind: "learner_response",
      sarGrading: {
        score: 80,
        correctCount: 4,
        expectedCount: 5,
        expectedAnswer: "one two three four five.",
      },
    });

    expect(delivery.advance_step).toBe(true);
    expect(delivery.reteach_current_step).toBe(false);
  });
});

describe("shouldAdvanceAfterDelivery", () => {
  it("requires advance_step true and reteach false", () => {
    expect(
      shouldAdvanceAfterDelivery({
        spoken_reply: "Great.",
        advance_step: true,
        reteach_current_step: false,
      }),
    ).toBe(true);
    expect(
      shouldAdvanceAfterDelivery({
        spoken_reply: "Try again.",
        advance_step: false,
        reteach_current_step: true,
      }),
    ).toBe(false);
  });
});

describe("question intro sanitization", () => {
  const openEndedPrompt =
    "Socho tum airport par kisi fellow traveler se mil rahe ho — tum apna introduction kaise doge? Mic on karke batao.";

  it("detects substantial overlap between setup and question prompt", () => {
    expect(textsOverlapSubstantially(openEndedPrompt, openEndedPrompt)).toBe(true);
    expect(
      textsOverlapSubstantially(
        "Deepesh, ab ek real-life situation try karte hain.",
        openEndedPrompt,
      ),
    ).toBe(false);
  });

  it("strips answer CTAs from open-ended setup", () => {
    expect(
      stripOpenEndedAnswerCues(
        "Deepesh, ab ek real-life situation try karte hain. Apne words mein bataiye.",
      ),
    ).toBe("Deepesh, ab ek real-life situation try karte hain.");
  });

  it("removes duplicated open-ended question text from spoken setup", () => {
    expect(stripQuestionPromptFromSpokenReply(openEndedPrompt, openEndedPrompt)).toBe("");
    expect(
      stripQuestionPromptFromSpokenReply(
        `Deepesh, ab ek real-life situation try karte hain. ${openEndedPrompt}`,
        openEndedPrompt,
      ),
    ).toBe("Deepesh, ab ek real-life situation try karte hain.");
  });

  it("sanitizes the reported duplicate open-ended intro bug", () => {
    const sanitized = sanitizeQuestionStepIntroReply(
      {
        type: "question",
        questionType: "open_ended",
        content: openEndedPrompt,
      },
      "Deepesh, ab ek real-life situation try karte hain. Apne words mein bataiye.",
    );

    expect(sanitized).toBe("Deepesh, ab ek real-life situation try karte hain.");
    expect(sanitized).not.toContain("Socho tum airport");
    expect(sanitized).not.toMatch(/apne words mein bataiye/i);
  });

  it("sanitizes SAR intros that duplicate the target sentence", () => {
    const sanitized = sanitizeQuestionStepIntroReply(
      {
        type: "question",
        questionType: "sar",
        content: "Ye sentence repeat kijiye: Good morning, here is my passport.",
        expectedAnswer: "Good morning, here is my passport.",
      },
      "Ye sentence repeat kijiye: Good morning, here is my passport.",
    );

    expect(sanitized).not.toContain("Good morning, here is my passport.");
    expect(sanitized).toMatch(/useful phrase/i);
  });

  it("sanitizes the check-in counter semantic duplicate bug from screenshot", () => {
    const questionPrompt =
      "Socho tum check-in counter par khade ho. Officer ko politely greet karo aur batao ki tumhari flight kahan ke liye hai.";
    const duplicateIntro =
      "Deepesh, ab check-in counter ka ek real-life scenario try karte hain. Imagine karo tum counter par khade ho, toh wahan officer se kaise baat shuru karoge aur apni flight ki details kaise doge?";

    const sanitized = sanitizeQuestionStepIntroReply(
      {
        type: "question",
        questionType: "open_ended",
        content: questionPrompt,
      },
      duplicateIntro,
    );

    expect(sanitized).toBe("");
    expect(sanitized).not.toContain("check-in counter");
    expect(sanitized).not.toContain("officer");
    expect(sanitized).not.toMatch(/imagine karo/i);
    expect(sanitized).not.toMatch(/kaise.*doge/i);
  });

  it("keeps a generic one-line open-ended setup when it does not overlap the card prompt", () => {
    const sanitized = sanitizeOpenEndedStepIntroReply(
      "Deepesh, ab ek real scenario try karte hain.",
      "Socho tum check-in counter par khade ho. Officer ko politely greet karo aur batao ki tumhari flight kahan ke liye hai.",
    );

    expect(sanitized).toBe("Deepesh, ab ek real scenario try karte hain.");
  });

  it("strips scenario patterns and question marks from open-ended setup", () => {
    expect(stripOpenEndedScenarioPatterns("Imagine karo tum counter par khade ho.")).toBe("");
    expect(
      sentenceSharesTopicWithPrompt(
        "Deepesh, ab check-in counter ka ek real-life scenario try karte hain.",
        "Socho tum check-in counter par khade ho. Officer ko politely greet karo.",
      ),
    ).toBe(true);
    expect(trimToFirstShortSentence("First short line. Second longer scenario line with officer and flight.")).toBe(
      "First short line.",
    );
  });
});
