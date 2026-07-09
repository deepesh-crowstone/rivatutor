import { deliverLessonTurn, createLessonPlan, classifyTopicChangeIntent, judgeIntentClarity, planCurriculum } from "@/lib/ai";
import { SAR_QUESTION_PROMPT, stripUiInstructions } from "@/lib/content";
import { stripReadyBoliyeFromSpeech } from "@/lib/assistant-speech";
import {
  buildFallbackLessonDelivery,
  formatRecentConversation,
  mergeChainedSpokenReplies,
  resolveAssistantMessageKind,
  resolveDeliverableStep,
  resolveOpenEndedQuestionPrompt,
  resolveStepIntroAssistantKind,
  sanitizeQuestionStepIntroReply,
  shouldAdvanceAfterDelivery,
  shouldChainStepIntro,
  shouldCreateSarRetryQuestionCard,
  shouldPersistLessonAnswerUserMessage,
} from "@/lib/lesson-delivery";
import { prisma } from "@/lib/db";
import { parseJsonArray, parseMetadata, stringifyJson } from "@/lib/json";
import { updateProfileFromConversation } from "@/lib/profile-pipeline";
import { getAppState, requireActiveLearner, toLearnerContext } from "@/lib/state";
import type { LessonDeliveryResult, LessonPlanStepReference, LessonTurnKind } from "@/lib/domain";
import {
  intentFollowUpFallback,
  topicChangeAckWithTitle,
  topicChangeClarifyMessage,
  topicCompleteMessage,
  topicSuggestionMessage,
} from "@/lib/cefr-copy";
import { resolveTopicChangeFromClassifier } from "@/lib/topic-change-resolve";
import type { TopicChangeDetection } from "@/lib/topic-change";
import { alignExpectedWords, diffTranscript } from "@/lib/word-diff";
import { extractUserInfo, mergeExtractedArrays } from "@/lib/user-extraction";

export async function submitIntentAnswer(answer: string) {
  const learner = await requireActiveLearner();
  const trimmed = answer.trim();
  if (!trimmed) {
    throw new Error("Apne English bolne ke goal ke baare mein thoda aur batayein.");
  }

  await prisma.chatMessage.create({
    data: {
      learnerId: learner.id,
      role: "user",
      kind: "intent_answer",
      content: trimmed,
    },
  });

  const messages = await prisma.chatMessage.findMany({
    where: { learnerId: learner.id, kind: { in: ["intent_question", "intent_answer"] } },
    orderBy: { createdAt: "asc" },
    take: 8,
  });
  const exchangeSoFar = messages.map((message) => `${message.role}: ${message.content}`).join("\n");
  let contextLearner = learner;

  try {
    const extracted = await extractUserInfo({
      userMessage: trimmed,
      conversationSoFar: exchangeSoFar,
      extractionGoal: "intent",
    });
    await mergeLearnerExtraction(learner.id, extracted);
    contextLearner =
      (await prisma.learnerProfile.findUnique({ where: { id: learner.id } })) ?? learner;
  } catch {
    // Intent flow continues even if extraction fails.
  }

  const clarity = await judgeIntentClarity({
    learnerAnswer: trimmed,
    exchangeSoFar,
    probeCount: learner.intentProbeCount,
    learnerContext: toLearnerContext(contextLearner),
  });
  const mustProceed = learner.intentProbeCount >= 2;

  if (!clarity.clear && !mustProceed) {
    await prisma.learnerProfile.update({
      where: { id: learner.id },
      data: {
        intentRaw: joinIntentRaw(learner.intentRaw, trimmed),
        intentProbeCount: { increment: 1 },
        intentClarityStatus: "probing",
      },
    });
    await prisma.chatMessage.create({
      data: {
        learnerId: learner.id,
        role: "assistant",
        kind: "intent_question",
        content: clarity.follow_up_question
          ? stripUiInstructions(clarity.follow_up_question)
          : intentFollowUpFallback(learner.selfDeclaredLevel),
      },
    });

    return getAppState();
  }

  const structured = clarity.structured_intent ?? {
    summary: trimmed,
    goal_contexts: ["general spoken English"],
    motivation: "The learner wants to improve spoken English.",
  };
  const updatedLearner = await prisma.learnerProfile.update({
    where: { id: learner.id },
    data: {
      intentRaw: joinIntentRaw(learner.intentRaw, trimmed),
      intentSummary: structured.summary,
      intentGoalContexts: stringifyJson(structured.goal_contexts),
      intentMotivation: structured.motivation,
      intentClarityStatus: clarity.structured_intent ? "clear" : "best_effort",
    },
  });

  const existingTopicCount = await prisma.topic.count({ where: { learnerId: learner.id } });
  if (existingTopicCount === 0) {
    const curriculum = await planCurriculum({
      level: updatedLearner.selfDeclaredLevel ?? "A2",
      intentSummary: structured.summary,
      goalContexts: structured.goal_contexts,
      motivation: structured.motivation,
      learnerContext: toLearnerContext(updatedLearner),
    });

    await prisma.topic.createMany({
      data: curriculum.topics.map((topic) => ({
        learnerId: learner.id,
        title: topic.title,
        description: topic.description,
        order: topic.order,
      })),
    });
  }

  await prisma.chatMessage.create({
    data: {
      learnerId: learner.id,
      role: "assistant",
      kind: "topic_suggestion",
      content: topicSuggestionMessage(updatedLearner.selfDeclaredLevel),
    },
  });

  try {
    await updateProfileFromConversation(learner.id);
  } catch {
    // Profile enrichment is best-effort.
  }

  return getAppState();
}

export async function lockTopic(input: { topicId?: string; freeformTitle?: string }) {
  const learner = await requireActiveLearner();
  const topic = input.topicId
    ? await prisma.topic.findFirst({ where: { id: input.topicId, learnerId: learner.id } })
    : await findOrCreateFreeformTopic(learner.id, input.freeformTitle ?? "");

  if (!topic) {
    throw new Error("Ek topic chuno ya Riva ko batao kya practice karna hai.");
  }

  await prisma.chatMessage.create({
    data: {
      learnerId: learner.id,
      topicId: topic.id,
      role: "user",
      kind: "topic_choice",
      content: `Let's practice ${topic.title}.`,
    },
  });

  const lessonPlan = await ensureLessonPlan(topic.id);
  const allSteps = await prisma.lessonStep.findMany({
    where: { lessonPlanId: lessonPlan.id },
    orderBy: { order: "asc" },
  });
  const firstStep = allSteps[0];

  if (!firstStep) {
    throw new Error("Riva could not create a lesson plan for this topic.");
  }

  const { step: deliverableReference, skippedOrders } = resolveDeliverableStep(
    allSteps.map(toStepReference),
    firstStep.order,
  );
  const deliverableStep = allSteps.find((step) => step.order === deliverableReference.order) ?? firstStep;

  await markStepsCompleted(allSteps, skippedOrders);

  await prisma.topic.updateMany({
    where: { learnerId: learner.id, status: "active" },
    data: { status: "pending" },
  });
  await prisma.topic.update({
    where: { id: topic.id },
    data: { status: "active" },
  });
  await prisma.learnerProgress.upsert({
    where: { learnerId: learner.id },
    update: {
      activeTopicId: topic.id,
      currentStepOrder: deliverableStep.order,
    },
    create: {
      learnerId: learner.id,
      activeTopicId: topic.id,
      currentStepOrder: deliverableStep.order,
    },
  });

  await deliverStepIntroChain({
    learnerId: learner.id,
    topic: {
      id: topic.id,
      title: topic.title,
      description: topic.description,
      learner,
    },
    startOrder: deliverableStep.order,
  });

  return getAppState();
}

export async function submitLessonAnswer(answer: string) {
  const learner = await requireActiveLearner();
  const progress = await prisma.learnerProgress.findUnique({ where: { learnerId: learner.id } });
  if (!progress?.activeTopicId) {
    throw new Error("Choose a topic before answering a lesson question.");
  }

  const topic = await prisma.topic.findUnique({
    where: { id: progress.activeTopicId },
    include: { learner: true },
  });
  const currentStep = await prisma.lessonStep.findFirst({
    where: {
      lessonPlan: { topicId: progress.activeTopicId },
      order: progress.currentStepOrder,
    },
  });

  if (!topic || !currentStep) {
    throw new Error("Riva could not find the active lesson step.");
  }

  const trimmed = answer.trim();
  const topicChange = await resolveTopicChangeIntent({
    utterance: trimmed,
    currentTopicTitle: topic.title,
    currentStep,
    learnerContext: toLearnerContext(topic.learner),
  });

  if (topicChange.wantsChange) {
    return handleMidLessonTopicChange({
      learnerId: learner.id,
      activeTopicId: topic.id,
      utterance: trimmed,
      detection: topicChange,
    });
  }

  const isPassiveStep = currentStep.type === "concept" || currentStep.type === "practice";
  const storedAnswer = trimmed || (isPassiveStep ? "" : "Continue");
  const displayAnswer = storedAnswer || "…";
  const stepReference = toStepReference(currentStep);

  if (shouldPersistLessonAnswerUserMessage(stepReference)) {
    await prisma.chatMessage.create({
      data: {
        learnerId: learner.id,
        topicId: topic.id,
        role: "user",
        kind: "lesson_answer",
        content: displayAnswer,
      },
    });
  }

  let sarDiff: ReturnType<typeof diffTranscript> | undefined;

  if (currentStep.type === "question" && currentStep.questionType === "sar") {
    sarDiff = diffTranscript(currentStep.expectedAnswer ?? "", trimmed);
    await updateSarQuestionMessageWithDiff({
      learnerId: learner.id,
      topicId: topic.id,
      stepId: currentStep.id,
      sarDiff,
    });
  }

  const delivery = await deliverStepTurn({
    learnerId: learner.id,
    topic,
    step: currentStep,
    turnKind: "learner_response",
    learnerUtterance: trimmed,
    sarGrading: sarDiff
      ? {
          score: sarDiff.score,
          correctCount: sarDiff.correctCount,
          expectedCount: sarDiff.expectedCount,
          expectedAnswer: currentStep.expectedAnswer ?? "",
        }
      : undefined,
  });

  await prisma.chatMessage.create({
    data: {
      learnerId: learner.id,
      topicId: topic.id,
      role: "assistant",
      kind: resolveAssistantMessageKind(stepReference, "learner_response"),
      content: delivery.spoken_reply,
      metadata: stringifyJson({
        stepId: currentStep.id,
        questionType: currentStep.questionType,
        delivery,
      }),
    },
  });

  if (shouldCreateSarRetryQuestionCard(delivery, stepReference)) {
    await prisma.chatMessage.create({
      data: {
        learnerId: learner.id,
        topicId: topic.id,
        role: "assistant",
        kind: "question",
        content: "",
        metadata: buildStepMessageMetadata(currentStep),
      },
    });
    return getAppState();
  }

  if (delivery.reteach_current_step) {
    return getAppState();
  }

  if (!shouldAdvanceAfterDelivery(delivery)) {
    return getAppState();
  }

  await prisma.lessonStep.update({
    where: { id: currentStep.id },
    data: { completed: true },
  });

  return advanceLesson(learner.id, topic.id, currentStep.order);
}

async function resolveTopicChangeIntent(input: {
  utterance: string;
  currentTopicTitle: string;
  currentStep: DbLessonStep;
  learnerContext: ReturnType<typeof toLearnerContext>;
}): Promise<TopicChangeDetection> {
  return resolveTopicChangeFromClassifier({
    utterance: input.utterance,
    currentTopicTitle: input.currentTopicTitle,
    classify: () =>
      classifyTopicChangeIntent({
        learnerUtterance: input.utterance.trim(),
        currentTopicTitle: input.currentTopicTitle,
        currentStepSummary: `${input.currentStep.type}${
          input.currentStep.questionType ? `/${input.currentStep.questionType}` : ""
        }: ${input.currentStep.content.slice(0, 160)}`,
        learnerContext: input.learnerContext,
      }),
  });
}

async function handleMidLessonTopicChange(input: {
  learnerId: string;
  activeTopicId: string;
  utterance: string;
  detection: TopicChangeDetection;
}) {
  await prisma.chatMessage.create({
    data: {
      learnerId: input.learnerId,
      topicId: input.activeTopicId,
      role: "user",
      kind: "topic_change",
      content: input.utterance.trim() || "Change topic",
    },
  });

  await abandonActiveLesson(input.learnerId, input.activeTopicId);

  const learner = await prisma.learnerProfile.findUnique({ where: { id: input.learnerId } });
  const level = learner?.selfDeclaredLevel ?? null;
  const newTitle = input.detection.topicClear ? input.detection.newTopicTitle?.trim() : null;
  if (newTitle) {
    await prisma.chatMessage.create({
      data: {
        learnerId: input.learnerId,
        role: "assistant",
        kind: "topic_change_ack",
        content: topicChangeAckWithTitle(newTitle, level),
      },
    });
    return lockTopic({ freeformTitle: newTitle });
  }

  await prisma.chatMessage.create({
    data: {
      learnerId: input.learnerId,
      role: "assistant",
      kind: "topic_suggestion",
      content: topicChangeClarifyMessage(level),
    },
  });

  return getAppState();
}

/** Clear active lesson progress so the old plan is no longer delivered. */
async function abandonActiveLesson(learnerId: string, topicId: string) {
  const lessonPlan = await prisma.lessonPlan.findUnique({ where: { topicId } });
  if (lessonPlan) {
    await prisma.lessonStep.updateMany({
      where: { lessonPlanId: lessonPlan.id },
      data: { completed: false },
    });
  }

  await prisma.topic.update({
    where: { id: topicId },
    data: { status: "pending" },
  });

  await prisma.learnerProgress.update({
    where: { learnerId },
    data: {
      activeTopicId: null,
      currentStepOrder: 0,
    },
  });
}

async function advanceLesson(learnerId: string, topicId: string, currentOrder: number) {
  const lessonPlan = await prisma.lessonPlan.findUnique({ where: { topicId } });
  if (!lessonPlan) {
    throw new Error("Lesson plan not found.");
  }

  const allSteps = await prisma.lessonStep.findMany({
    where: { lessonPlanId: lessonPlan.id },
    orderBy: { order: "asc" },
  });
  const currentStep = allSteps.find((step) => step.order === currentOrder);
  const nextCandidate = allSteps.find((step) => step.order > currentOrder);

  if (!nextCandidate) {
    if (currentStep?.type === "recap") {
      return completeTopic(learnerId, topicId);
    }
    throw new Error("Lesson plan is missing a recap step after the final question.");
  }

  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    include: { learner: true },
  });
  if (!topic) {
    throw new Error("Topic not found.");
  }

  return deliverStepIntroChain({
    learnerId,
    topic,
    startOrder: nextCandidate.order,
  });
}

async function deliverStepIntroChain(input: {
  learnerId: string;
  topic: DbTopic;
  startOrder: number;
}) {
  const lessonPlan = await prisma.lessonPlan.findUnique({ where: { topicId: input.topic.id } });
  if (!lessonPlan) {
    throw new Error("Lesson plan not found.");
  }

  const allSteps = await prisma.lessonStep.findMany({
    where: { lessonPlanId: lessonPlan.id },
    orderBy: { order: "asc" },
  });
  const stepReferences = allSteps.map(toStepReference);
  let order = input.startOrder;
  const spokenParts: string[] = [];
  let finalStep: DbLessonStep | null = null;
  let finalDelivery: LessonDeliveryResult | null = null;
  let completedRecap = false;

  while (true) {
    const { step: deliverableReference, skippedOrders } = resolveDeliverableStep(stepReferences, order);
    const step = allSteps.find((candidate) => candidate.order === deliverableReference.order);
    if (!step) {
      throw new Error("Riva could not find the active lesson step.");
    }

    await markStepsCompleted(allSteps, skippedOrders);

    const stepIndex = allSteps.findIndex((candidate) => candidate.id === step.id);
    const nextStepReference = stepIndex >= 0 ? stepReferences[stepIndex + 1] ?? null : null;
    const stepReference = toStepReference(step);

    const delivery = await deliverStepTurn({
      learnerId: input.learnerId,
      topic: input.topic,
      step,
      turnKind: "step_intro",
      nextStep: nextStepReference,
    });

    const spoken =
      step.type === "question" && step.questionType === "open_ended"
        ? sanitizeQuestionStepIntroReply(stepReference, delivery.spoken_reply)
        : delivery.spoken_reply;
    spokenParts.push(spoken);
    finalStep = step;
    finalDelivery = delivery;

    const shouldChain = shouldChainStepIntro(stepReference);

    if (shouldChain) {
      await prisma.lessonStep.update({ where: { id: step.id }, data: { completed: true } });
      if (step.type === "recap") {
        completedRecap = true;
        break;
      }
      if (!nextStepReference) {
        break;
      }
      order = nextStepReference.order;
      continue;
    }

    break;
  }

  if (!finalStep || !finalDelivery) {
    throw new Error("Riva could not deliver the lesson intro.");
  }

  const finalReference = toStepReference(finalStep);
  await prisma.chatMessage.create({
    data: {
      learnerId: input.learnerId,
      topicId: input.topic.id,
      role: "assistant",
      kind: resolveStepIntroAssistantKind(finalReference),
      content: mergeChainedSpokenReplies(spokenParts),
      metadata: buildStepMessageMetadata(finalStep, { delivery: finalDelivery }),
    },
  });

  if (completedRecap) {
    return completeTopic(input.learnerId, input.topic.id);
  }

  await prisma.learnerProgress.update({
    where: { learnerId: input.learnerId },
    data: { currentStepOrder: finalStep.order },
  });

  return getAppState();
}

async function completeTopic(learnerId: string, topicId: string) {
  const progress = await prisma.learnerProgress.findUnique({ where: { learnerId } });
  const learner = await prisma.learnerProfile.findUnique({ where: { id: learnerId } });
  const completed = new Set(parseJsonArray(progress?.completedTopicIds));
  completed.add(topicId);
  await prisma.topic.update({
    where: { id: topicId },
    data: { status: "completed" },
  });
  await prisma.learnerProgress.update({
    where: { learnerId },
    data: {
      activeTopicId: null,
      currentStepOrder: 0,
      completedTopicIds: stringifyJson([...completed]),
    },
  });
  await prisma.chatMessage.create({
    data: {
      learnerId,
      role: "assistant",
      kind: "topic_complete",
      content: topicCompleteMessage(learner?.selfDeclaredLevel),
    },
  });

  try {
    await updateProfileFromConversation(learnerId);
  } catch {
    // Profile enrichment is best-effort.
  }

  return getAppState();
}

async function ensureLessonPlan(topicId: string) {
  const existing = await prisma.lessonPlan.findUnique({
    where: { topicId },
  });
  if (existing) {
    return existing;
  }

  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    include: { learner: true },
  });
  if (!topic) {
    throw new Error("Topic not found.");
  }

  const goalContexts = parseJsonArray(topic.learner.intentGoalContexts);
  const plan = await createLessonPlan({
    topicTitle: topic.title,
    topicDescription: topic.description,
    level: topic.learner.selfDeclaredLevel ?? "A2",
    intentSummary: topic.learner.intentSummary ?? "General spoken English improvement",
    goalContexts,
    learnerContext: toLearnerContext(topic.learner),
  });

  return prisma.lessonPlan.create({
    data: {
      topicId,
      level: topic.learner.selfDeclaredLevel ?? "A2",
      intentSnapshot: stringifyJson({
        summary: topic.learner.intentSummary,
        goalContexts,
        motivation: topic.learner.intentMotivation,
      }),
      steps: {
        create: plan.steps.map((step, index) => ({
          order: index + 1,
          type: step.type,
          questionType: step.type === "question" ? step.questionType ?? "open_ended" : null,
          content: stripUiInstructions(
            step.type === "question" && step.questionType === "open_ended"
              ? step.questionPrompt ?? step.content
              : step.content,
          ),
          expectedAnswer: step.expectedAnswer,
        })),
      },
    },
  });
}

async function findOrCreateFreeformTopic(learnerId: string, title: string) {
  const normalized = normalizeTopicTitle(title);
  if (!normalized) {
    return null;
  }

  const existingTopics = await prisma.topic.findMany({ where: { learnerId } });
  const match = existingTopics.find((topic) => {
    const existing = normalizeTopicTitle(topic.title);
    return existing === normalized || existing.includes(normalized) || normalized.includes(existing);
  });

  if (match) {
    return match;
  }

  const maxTopic = await prisma.topic.findFirst({
    where: { learnerId },
    orderBy: { order: "desc" },
  });

  return prisma.topic.create({
    data: {
      learnerId,
      title: title.trim(),
      description: `A learner-requested spoken-English practice topic: ${title.trim()}.`,
      order: (maxTopic?.order ?? 0) + 1,
      source: "freeform",
    },
  });
}

function joinIntentRaw(existing: string | null, answer: string) {
  return [existing, answer].filter(Boolean).join("\n");
}

async function mergeLearnerExtraction(
  learnerId: string,
  extraction: { interests?: string[]; key_facts?: string[] },
) {
  const learner = await prisma.learnerProfile.findUnique({ where: { id: learnerId } });
  if (!learner) {
    return;
  }

  const userInterests = mergeExtractedArrays(parseJsonArray(learner.userInterests), extraction.interests ?? []);
  const extractedKeyFacts = mergeExtractedArrays(
    parseJsonArray(learner.extractedKeyFacts),
    extraction.key_facts ?? [],
  );

  await prisma.learnerProfile.update({
    where: { id: learnerId },
    data: {
      userInterests: stringifyJson(userInterests),
      extractedKeyFacts: stringifyJson(extractedKeyFacts),
    },
  });
}

function normalizeTopicTitle(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

type DbLessonStep = {
  id: string;
  order: number;
  type: string;
  questionType: string | null;
  content: string;
  expectedAnswer: string | null;
};

type DbTopic = {
  id: string;
  title: string;
  description: string;
  learner: {
    selfDeclaredLevel: string | null;
    intentSummary: string | null;
    intentGoalContexts: string;
    name: string | null;
    userInterests: string;
    extractedKeyFacts: string;
    intentMotivation: string | null;
  };
};

function toStepReference(step: DbLessonStep): LessonPlanStepReference {
  return {
    order: step.order,
    type: step.type,
    questionType: step.questionType,
    content: step.content,
    expectedAnswer: step.expectedAnswer,
  };
}

function buildStepMessageMetadata(step: DbLessonStep, extra?: Record<string, unknown>) {
  return stringifyJson({
    stepId: step.id,
    questionType: step.questionType,
    ...(step.type === "question" && step.questionType === "sar" && step.expectedAnswer
      ? { expectedAnswer: step.expectedAnswer, questionPrompt: SAR_QUESTION_PROMPT }
      : {}),
    ...(step.type === "question" && step.questionType === "open_ended"
      ? { questionPrompt: resolveOpenEndedQuestionPrompt(step) }
      : {}),
    ...extra,
  });
}

async function markStepsCompleted(steps: DbLessonStep[], skippedOrders: number[]) {
  if (skippedOrders.length === 0) {
    return;
  }

  const skippedIds = steps.filter((step) => skippedOrders.includes(step.order)).map((step) => step.id);
  if (skippedIds.length === 0) {
    return;
  }

  await prisma.lessonStep.updateMany({
    where: { id: { in: skippedIds } },
    data: { completed: true },
  });
}

async function updateSarQuestionMessageWithDiff(input: {
  learnerId: string;
  topicId: string;
  stepId: string;
  sarDiff: ReturnType<typeof diffTranscript>;
}) {
  const candidates = await prisma.chatMessage.findMany({
    where: {
      learnerId: input.learnerId,
      topicId: input.topicId,
      role: "assistant",
      kind: "question",
    },
    orderBy: { createdAt: "desc" },
    take: 12,
  });

  const target = candidates.find((message) => {
    const metadata = parseMetadata(message.metadata);
    if (!metadata || typeof metadata !== "object") {
      return false;
    }

    const record = metadata as Record<string, unknown>;
    return record.stepId === input.stepId && record.questionType === "sar";
  });

  if (!target) {
    return;
  }

  const existingMetadata = parseMetadata(target.metadata);
  const record =
    existingMetadata && typeof existingMetadata === "object"
      ? (existingMetadata as Record<string, unknown>)
      : {};

  await prisma.chatMessage.update({
    where: { id: target.id },
    data: {
      metadata: stringifyJson({
        ...record,
        wordDiff: {
          score: input.sarDiff.score,
          correctCount: input.sarDiff.correctCount,
          expectedCount: input.sarDiff.expectedCount,
          tokens: alignExpectedWords(input.sarDiff.expected, input.sarDiff.actual),
        },
      }),
    },
  });
}

async function loadLessonDeliveryContext(learnerId: string, topicId: string) {
  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    include: { learner: true },
  });
  if (!topic) {
    throw new Error("Topic not found.");
  }

  const steps = await prisma.lessonStep.findMany({
    where: { lessonPlan: { topicId } },
    orderBy: { order: "asc" },
  });
  const messages = await prisma.chatMessage.findMany({
    where: { learnerId, topicId },
    orderBy: { createdAt: "asc" },
    take: 16,
  });

  return {
    topic,
    steps: steps.map(toStepReference),
    recentConversation: formatRecentConversation(messages),
    learnerContext: toLearnerContext(topic.learner),
    goalContexts: parseJsonArray(topic.learner.intentGoalContexts),
  };
}

async function deliverStepTurn(input: {
  learnerId: string;
  topic: Pick<DbTopic, "id" | "title" | "description" | "learner">;
  step: DbLessonStep;
  turnKind: LessonTurnKind;
  learnerUtterance?: string;
  nextStep?: LessonPlanStepReference | null;
  sarGrading?: {
    score: number;
    correctCount: number;
    expectedCount: number;
    expectedAnswer: string;
  };
}): Promise<LessonDeliveryResult> {
  const context = await loadLessonDeliveryContext(input.learnerId, input.topic.id);
  const stepReference = toStepReference(input.step);
  const nextStep =
    input.nextStep ??
    context.steps.find((step) => step.order > stepReference.order) ??
    null;

  try {
    const delivery = await deliverLessonTurn({
      topicTitle: input.topic.title,
      topicDescription: input.topic.description,
      level: input.topic.learner.selfDeclaredLevel ?? "A2",
      intentSummary: input.topic.learner.intentSummary ?? "General spoken English improvement",
      goalContexts: context.goalContexts,
      lessonSteps: context.steps,
      currentStep: stepReference,
      nextStep,
      turnKind: input.turnKind,
      recentConversation: context.recentConversation,
      learnerUtterance: input.learnerUtterance,
      sarGrading: input.sarGrading,
      learnerContext: context.learnerContext,
    });

    return {
      ...delivery,
      spoken_reply: postProcessSpokenReply(stepReference, input.turnKind, delivery.spoken_reply),
    };
  } catch {
    const fallback = buildFallbackLessonDelivery({
      step: stepReference,
      turnKind: input.turnKind,
      nextStep,
      sarGrading: input.sarGrading,
      level: input.topic.learner.selfDeclaredLevel,
    });

    return {
      ...fallback,
      spoken_reply: postProcessSpokenReply(stepReference, input.turnKind, fallback.spoken_reply),
    };
  }
}

function postProcessSpokenReply(
  step: LessonPlanStepReference,
  turnKind: LessonTurnKind,
  spokenReply: string,
): string {
  let cleaned = stripReadyBoliyeFromSpeech(stripUiInstructions(spokenReply));
  if (turnKind === "step_intro" && step.type === "question") {
    cleaned = sanitizeQuestionStepIntroReply(step, cleaned);
  }
  return cleaned;
}
