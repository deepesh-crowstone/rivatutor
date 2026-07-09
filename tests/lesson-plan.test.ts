import { describe, expect, it } from "vitest";
import { getLessonPlanQuestionMix, lessonPlanSchema, lessonPlanSchemaForLevel } from "@/lib/domain";

function buildValidA2Plan() {
  return {
    steps: [
      { type: "concept", content: "Concept one about airport check-in grammar." },
      { type: "concept", content: "Concept two about polite greetings." },
      { type: "practice", content: "Practice bridge before phrases." },
      {
        type: "question",
        questionType: "sar",
        content: "Ye sentence repeat kijiye: Good morning.",
        expectedAnswer: "Good morning.",
      },
      {
        type: "question",
        questionType: "sar",
        content: "Ye sentence repeat kijiye: Here is my passport.",
        expectedAnswer: "Here is my passport.",
      },
      {
        type: "question",
        questionType: "sar",
        content: "Ab yeh try kijiye: Where is ___ five?",
        expectedAnswer: "Where is gate five?",
      },
      {
        type: "question",
        questionType: "open_ended",
        content: "Apne words mein check-in par kya bolenge?",
      },
      {
        type: "question",
        questionType: "open_ended",
        content: "Real life mein gate kaise poochhoge?",
      },
      { type: "recap", content: "Aaj humne airport phrases practice ki." },
    ],
  };
}

function buildValidC1Plan() {
  return {
    steps: [
      { type: "concept", content: "At check-in, clarity and calm tone matter more than fixed phrases." },
      { type: "concept", content: "When plans change, frame the issue and propose a solution." },
      { type: "practice", content: "Next you will handle realistic scenarios in your own words." },
      {
        type: "question",
        questionType: "open_ended",
        content: "Brief setup.",
        questionPrompt: "Your preferred seat is gone — negotiate an alternative.",
      },
      {
        type: "question",
        questionType: "open_ended",
        content: "Brief setup.",
        questionPrompt: "Politely insist the agent recheck your booking.",
      },
      {
        type: "question",
        questionType: "open_ended",
        content: "Brief setup.",
        questionPrompt: "Your flight is delayed — persuade them to help rebook.",
      },
      {
        type: "question",
        questionType: "open_ended",
        content: "Brief setup.",
        questionPrompt: "Push back on a later flight you do not want.",
      },
      { type: "recap", content: "You practiced negotiating check-in problems with confident English." },
    ],
  };
}

describe("getLessonPlanQuestionMix", () => {
  it("requires SAR for A1–A2 and forbids SAR for C1–C2", () => {
    expect(getLessonPlanQuestionMix("A2")).toMatchObject({ minSar: 3, minOpenEnded: 2 });
    expect(getLessonPlanQuestionMix("B1")).toMatchObject({ minSar: 2, minOpenEnded: 2 });
    expect(getLessonPlanQuestionMix("C1")).toMatchObject({ minSar: 0, maxSar: 0, minOpenEnded: 4 });
    expect(getLessonPlanQuestionMix("C2").maxSar).toBe(0);
  });
});

describe("lessonPlanSchema", () => {
  it("accepts an elaborate A1–A2 lesson plan with required question mix", () => {
    const parsed = lessonPlanSchema.parse(buildValidA2Plan());
    expect(parsed.steps).toHaveLength(9);
    expect(parsed.steps.at(-1)?.type).toBe("recap");
  });

  it("rejects plans with fewer than 8 steps", () => {
    const shortPlan = buildValidA2Plan();
    shortPlan.steps = shortPlan.steps.slice(0, 5);

    expect(() => lessonPlanSchema.parse(shortPlan)).toThrow();
  });

  it("rejects A1–A2 plans without at least 3 SAR questions", () => {
    const plan = buildValidA2Plan();
    plan.steps = plan.steps.filter(
      (step) =>
        !(
          step.type === "question" &&
          step.questionType === "sar" &&
          step.content.includes("Where is")
        ),
    );

    expect(() => lessonPlanSchema.parse(plan)).toThrow(/3 SAR/i);
  });

  it("rejects plans without enough open_ended questions for the level", () => {
    const plan = buildValidA2Plan();
    plan.steps = plan.steps.filter(
      (step) => !(step.type === "question" && step.questionType === "open_ended" && step.content.includes("gate")),
    );

    expect(() => lessonPlanSchema.parse(plan)).toThrow(/2 open_ended/i);
  });

  it("rejects plans that do not end with recap", () => {
    const plan = buildValidA2Plan();
    plan.steps = [...plan.steps.slice(0, -1), { type: "concept", content: "Extra concept at end." }];

    expect(() => lessonPlanSchema.parse(plan)).toThrow(/recap/i);
  });
});

describe("lessonPlanSchemaForLevel", () => {
  it("accepts C1 plans with open_ended only and no SAR", () => {
    const parsed = lessonPlanSchemaForLevel("C1").parse(buildValidC1Plan());
    expect(parsed.steps.filter((step) => step.questionType === "sar")).toHaveLength(0);
    expect(parsed.steps.filter((step) => step.questionType === "open_ended").length).toBeGreaterThanOrEqual(4);
  });

  it("rejects C1 plans that include SAR", () => {
    const plan = buildValidC1Plan();
    plan.steps = [
      ...plan.steps.slice(0, 3),
      {
        type: "question",
        questionType: "sar",
        content: "Repeat: Good morning.",
        expectedAnswer: "Good morning.",
      },
      ...plan.steps.slice(3),
    ];

    expect(() => lessonPlanSchemaForLevel("C1").parse(plan)).toThrow(/must not include SAR/i);
  });

  it("rejects C1 plans with fewer than 4 open_ended questions", () => {
    const plan = buildValidC1Plan();
    plan.steps = [
      { type: "concept", content: "Extra concept to keep step count valid." },
      ...plan.steps.filter(
        (step) => !(step.type === "question" && step.questionPrompt?.includes("later flight")),
      ),
    ];

    expect(() => lessonPlanSchemaForLevel("C1").parse(plan)).toThrow(/4 open_ended/i);
  });

  it("still requires SAR for A2 via level-aware schema", () => {
    expect(() => lessonPlanSchemaForLevel("A2").parse(buildValidC1Plan())).toThrow(/3 SAR/i);
  });
});
