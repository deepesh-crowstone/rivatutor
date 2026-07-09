import { z } from "zod";

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

export type LessonPlanQuestionMix = {
  minQuestions: number;
  minSar: number;
  maxSar: number;
  minOpenEnded: number;
};

/** Question-mix requirements for lesson plans by CEFR level. C1–C2: no SAR. */
export function getLessonPlanQuestionMix(level?: string | null): LessonPlanQuestionMix {
  const normalized = (level ?? "").trim().toUpperCase();
  if (normalized === "C1" || normalized === "C2") {
    return { minQuestions: 4, minSar: 0, maxSar: 0, minOpenEnded: 4 };
  }
  if (normalized === "B1" || normalized === "B2") {
    return { minQuestions: 4, minSar: 2, maxSar: 4, minOpenEnded: 2 };
  }
  // A1–A2 and unknown/missing
  return { minQuestions: 4, minSar: 3, maxSar: 6, minOpenEnded: 2 };
}

export const LESSON_STEP_TYPES = ["concept", "question", "practice", "recap"] as const;
export type LessonStepType = (typeof LESSON_STEP_TYPES)[number];

export const QUESTION_TYPES = ["sar", "open_ended"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export type TopicStatus = "pending" | "active" | "completed";

export const intentClaritySchema = z.object({
  clear: z.boolean(),
  structured_intent: z
    .object({
      summary: z.string().min(1),
      goal_contexts: z.array(z.string()).default([]),
      motivation: z.string().min(1),
    })
    .optional(),
  follow_up_question: z.string().optional(),
});

export type IntentClarityResult = z.infer<typeof intentClaritySchema>;

export const curriculumSchema = z.object({
  topics: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        order: z.number().int().positive(),
      }),
    )
    .min(8)
    .max(15),
});

export type CurriculumResult = z.infer<typeof curriculumSchema>;

const lessonPlanStepSchema = z.object({
  type: z.enum(LESSON_STEP_TYPES),
  questionType: z.enum(QUESTION_TYPES).optional(),
  content: z.string().min(1),
  questionPrompt: z.string().optional(),
  expectedAnswer: z.string().optional(),
});

/** Shared step-shape checks used by default and CEFR-aware lesson plan schemas. */
function refineLessonPlanSteps(
  steps: z.infer<typeof lessonPlanStepSchema>[],
  ctx: z.RefinementCtx,
  mix: LessonPlanQuestionMix,
) {
  const questionSteps = steps.filter((step) => step.type === "question");
  const sarCount = questionSteps.filter((step) => step.questionType === "sar").length;
  const openEndedCount = questionSteps.filter((step) => step.questionType === "open_ended").length;

  if (questionSteps.length < mix.minQuestions) {
    ctx.addIssue({
      code: "custom",
      message: `Lesson plan must include at least ${mix.minQuestions} question steps.`,
    });
  }

  if (sarCount < mix.minSar) {
    ctx.addIssue({
      code: "custom",
      message: `Lesson plan must include at least ${mix.minSar} SAR question steps.`,
    });
  }

  if (sarCount > mix.maxSar) {
    ctx.addIssue({
      code: "custom",
      message:
        mix.maxSar === 0
          ? "Lesson plan for C1–C2 must not include SAR (sentence-repeat) question steps."
          : `Lesson plan must include at most ${mix.maxSar} SAR question steps for this CEFR level.`,
    });
  }

  if (openEndedCount < mix.minOpenEnded) {
    ctx.addIssue({
      code: "custom",
      message: `Lesson plan must include at least ${mix.minOpenEnded} open_ended question steps.`,
    });
  }

  const lastStep = steps[steps.length - 1];
  if (!lastStep || lastStep.type !== "recap") {
    ctx.addIssue({
      code: "custom",
      message: "Lesson plan must end with a recap step.",
    });
  }

  for (const [index, step] of steps.entries()) {
    if (step.type === "question" && step.questionType === "sar" && !step.expectedAnswer?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: `SAR question step at index ${index} requires expectedAnswer.`,
      });
    }
  }
}

/** Default schema (A1–A2 mix) — used when level is unknown. Prefer `lessonPlanSchemaForLevel`. */
export const lessonPlanSchema = z.object({
  steps: z
    .array(lessonPlanStepSchema)
    .min(8)
    .max(12)
    .superRefine((steps, ctx) => {
      refineLessonPlanSteps(steps, ctx, getLessonPlanQuestionMix("A2"));
    }),
});

/** CEFR-aware lesson plan schema — C1/C2 forbid SAR and require open_ended-heavy plans. */
export function lessonPlanSchemaForLevel(level?: string | null) {
  const mix = getLessonPlanQuestionMix(level);
  return z.object({
    steps: z
      .array(lessonPlanStepSchema)
      .min(8)
      .max(12)
      .superRefine((steps, ctx) => {
        refineLessonPlanSteps(steps, ctx, mix);
      }),
  });
}

export type LessonPlanResult = z.infer<typeof lessonPlanSchema>;

export type LessonTurnKind = "step_intro" | "learner_response";

export const lessonDeliverySchema = z.object({
  spoken_reply: z.string().min(1),
  advance_step: z.boolean(),
  reteach_current_step: z.boolean().default(false),
  internal_notes: z.string().optional(),
});

export type LessonDeliveryResult = z.infer<typeof lessonDeliverySchema>;

export const topicChangeIntentSchema = z.object({
  wants_topic_change: z.boolean(),
  new_topic_title: z.string().nullable().optional(),
  topic_clear: z.boolean().default(false),
  acknowledgment: z.string().optional(),
});

export type TopicChangeIntentResult = z.infer<typeof topicChangeIntentSchema>;

export type LessonPlanStepReference = {
  order: number;
  type: LessonStepType | string;
  questionType?: QuestionType | string | null;
  content: string;
  questionPrompt?: string | null;
  expectedAnswer?: string | null;
};

export type SarGradingContext = {
  score: number;
  correctCount: number;
  expectedCount: number;
  expectedAnswer: string;
};

export const userInfoExtractionSchema = z.object({
  name: z.string().nullable().optional(),
  name_provided: z.boolean().optional(),
  follow_up_question: z.string().nullable().optional(),
  level: z.enum(CEFR_LEVELS).optional(),
  interests: z.array(z.string()).default([]),
  key_facts: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
});

export type UserInfoExtraction = z.infer<typeof userInfoExtractionSchema>;

export const profileUpdateResultSchema = z.object({
  interests: z.array(z.string()).default([]),
  key_facts: z.array(z.string()).default([]),
  intent_summary: z.string().optional(),
  name: z.string().nullable().optional(),
});

export type ProfileUpdateResult = z.infer<typeof profileUpdateResultSchema>;
export type ExtractionGoal = "name" | "level" | "intent";

export type LearnerContextInput = {
  name?: string | null;
  selfDeclaredLevel?: string | null;
  userInterests?: string[];
  extractedKeyFacts?: string[];
  intentSummary?: string | null;
  intentGoalContexts?: string[];
  intentMotivation?: string | null;
};

export type LearnerProfileDto = {
  id: string;
  username: string | null;
  name: string | null;
  selfDeclaredLevel: string | null;
  intentRaw: string | null;
  intentSummary: string | null;
  intentGoalContexts: string[];
  intentMotivation: string | null;
  intentClarityStatus: string;
  intentProbeCount: number;
  userInterests: string[];
  extractedKeyFacts: string[];
};

export type TopicDto = {
  id: string;
  title: string;
  description: string;
  order: number;
  status: TopicStatus | string;
  source: string;
};

export type LessonStepDto = {
  id: string;
  order: number;
  type: LessonStepType | string;
  questionType: QuestionType | string | null;
  content: string;
  expectedAnswer: string | null;
  completed: boolean;
};

export type SarWordDiffToken = {
  word: string;
  status: "correct" | "incorrect" | "missing" | "pending";
};

export type SarWordDiff = {
  score: number;
  correctCount: number;
  expectedCount: number;
  tokens: SarWordDiffToken[];
};

export type QuestionCardMetadata = {
  stepId?: string;
  questionType?: QuestionType | string | null;
  expectedAnswer?: string;
  questionPrompt?: string;
  wordDiff?: SarWordDiff;
  sarAnswer?: boolean;
};

/** @deprecated Use QuestionCardMetadata */
export type SarQuestionMetadata = QuestionCardMetadata;

export type ChatMessageDto = {
  id: string;
  role: string;
  kind: string;
  content: string;
  metadata: unknown;
  createdAt: string;
};

export type AppState = {
  needsUsername: boolean;
  profile: LearnerProfileDto;
  topics: TopicDto[];
  activeTopic: TopicDto | null;
  currentStep: LessonStepDto | null;
  messages: ChatMessageDto[];
  missingApiKey: boolean;
};
