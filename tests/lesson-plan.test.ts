import { describe, expect, it } from "vitest";
import { lessonPlanSchema } from "@/lib/domain";

function buildValidPlan() {
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

describe("lessonPlanSchema", () => {
  it("accepts an elaborate lesson plan with required question mix", () => {
    const parsed = lessonPlanSchema.parse(buildValidPlan());
    expect(parsed.steps).toHaveLength(9);
    expect(parsed.steps.at(-1)?.type).toBe("recap");
  });

  it("rejects plans with fewer than 8 steps", () => {
    const shortPlan = buildValidPlan();
    shortPlan.steps = shortPlan.steps.slice(0, 5);

    expect(() => lessonPlanSchema.parse(shortPlan)).toThrow();
  });

  it("rejects plans without at least 3 SAR questions", () => {
    const plan = buildValidPlan();
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

  it("rejects plans without at least 2 open_ended questions", () => {
    const plan = buildValidPlan();
    plan.steps = plan.steps.filter(
      (step) => !(step.type === "question" && step.questionType === "open_ended" && step.content.includes("gate")),
    );

    expect(() => lessonPlanSchema.parse(plan)).toThrow(/2 open_ended/i);
  });

  it("rejects plans that do not end with recap", () => {
    const plan = buildValidPlan();
    plan.steps = [...plan.steps.slice(0, -1), { type: "concept", content: "Extra concept at end." }];

    expect(() => lessonPlanSchema.parse(plan)).toThrow(/recap/i);
  });
});
