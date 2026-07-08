import { hasRequiredApiKeys } from "@/lib/env";
import { stripUiInstructions } from "@/lib/content";
import { parseJsonArray, parseMetadata } from "@/lib/json";
import { ensureWelcomeMessage } from "@/lib/onboarding";
import { getActiveUsername } from "@/lib/session";
import type { AppState, ChatMessageDto, LearnerContextInput, LessonStepDto, TopicDto } from "@/lib/domain";
import { prisma } from "@/lib/db";

export function toLearnerContext(learner: {
  name: string | null;
  selfDeclaredLevel: string | null;
  userInterests: string;
  extractedKeyFacts: string;
  intentSummary: string | null;
  intentGoalContexts: string;
  intentMotivation: string | null;
}): LearnerContextInput {
  return {
    name: learner.name,
    selfDeclaredLevel: learner.selfDeclaredLevel,
    userInterests: parseJsonArray(learner.userInterests),
    extractedKeyFacts: parseJsonArray(learner.extractedKeyFacts),
    intentSummary: learner.intentSummary,
    intentGoalContexts: parseJsonArray(learner.intentGoalContexts),
    intentMotivation: learner.intentMotivation,
  };
}

export async function requireActiveLearner() {
  const username = await getActiveUsername();
  if (!username) {
    throw new Error("Please choose a username before continuing.");
  }

  const learner = await prisma.learnerProfile.findUnique({ where: { username } });
  if (!learner) {
    throw new Error("Active user not found. Please choose your username again.");
  }

  await prisma.learnerProgress.upsert({
    where: { learnerId: learner.id },
    update: {},
    create: { learnerId: learner.id },
  });

  return learner;
}

function emptyAppState(): AppState {
  return {
    needsUsername: true,
    profile: {
      id: "",
      username: null,
      name: null,
      selfDeclaredLevel: null,
      intentRaw: null,
      intentSummary: null,
      intentGoalContexts: [],
      intentMotivation: null,
      intentClarityStatus: "unknown",
      intentProbeCount: 0,
      userInterests: [],
      extractedKeyFacts: [],
    },
    topics: [],
    activeTopic: null,
    currentStep: null,
    messages: [],
    missingApiKey: !hasRequiredApiKeys(),
  };
}

export async function getAppState(): Promise<AppState> {
  const username = await getActiveUsername();
  if (!username) {
    return emptyAppState();
  }

  const learner = await prisma.learnerProfile.findUnique({ where: { username } });
  if (!learner) {
    return emptyAppState();
  }

  await ensureWelcomeMessage(learner.id, learner.name);
  const progress = await prisma.learnerProgress.upsert({
    where: { learnerId: learner.id },
    update: {},
    create: { learnerId: learner.id },
  });
  const topics = await prisma.topic.findMany({
    where: { learnerId: learner.id },
    orderBy: { order: "asc" },
  });
  const activeTopic = progress.activeTopicId
    ? await prisma.topic.findUnique({ where: { id: progress.activeTopicId } })
    : null;
  const currentStep = activeTopic
    ? await prisma.lessonStep.findFirst({
        where: {
          lessonPlan: { topicId: activeTopic.id },
          order: progress.currentStepOrder,
        },
        orderBy: { order: "asc" },
      })
    : null;
  const messages = await prisma.chatMessage.findMany({
    where: { learnerId: learner.id },
    orderBy: { createdAt: "asc" },
    take: 80,
  });

  return {
    needsUsername: false,
    profile: {
      id: learner.id,
      username: learner.username,
      name: learner.name,
      selfDeclaredLevel: learner.selfDeclaredLevel,
      intentRaw: learner.intentRaw,
      intentSummary: learner.intentSummary,
      intentGoalContexts: parseJsonArray(learner.intentGoalContexts),
      intentMotivation: learner.intentMotivation,
      intentClarityStatus: learner.intentClarityStatus,
      intentProbeCount: learner.intentProbeCount,
      userInterests: parseJsonArray(learner.userInterests),
      extractedKeyFacts: parseJsonArray(learner.extractedKeyFacts),
    },
    topics: topics.map(toTopicDto),
    activeTopic: activeTopic ? toTopicDto(activeTopic) : null,
    currentStep: currentStep ? toLessonStepDto(currentStep) : null,
    messages: messages
      .filter((message) => message.kind !== "username_answer")
      .filter((message) => !isHiddenLessonAnswerMessage(message))
      .map(toMessageDto),
    missingApiKey: !hasRequiredApiKeys(),
  };
}

function toTopicDto(topic: {
  id: string;
  title: string;
  description: string;
  order: number;
  status: string;
  source: string;
}): TopicDto {
  return {
    id: topic.id,
    title: topic.title,
    description: topic.description,
    order: topic.order,
    status: topic.status,
    source: topic.source,
  };
}

function toLessonStepDto(step: {
  id: string;
  order: number;
  type: string;
  questionType: string | null;
  content: string;
  expectedAnswer: string | null;
  completed: boolean;
}): LessonStepDto {
  return {
    id: step.id,
    order: step.order,
    type: step.type,
    questionType: step.questionType,
    content: step.content,
    expectedAnswer: step.expectedAnswer,
    completed: step.completed,
  };
}

function isHiddenLessonAnswerMessage(message: {
  role: string;
  kind: string;
  metadata: string | null;
}) {
  if (message.role !== "user" || message.kind !== "lesson_answer") {
    return false;
  }

  const metadata = parseMetadata(message.metadata);
  if (!metadata || typeof metadata !== "object") {
    return false;
  }

  return (metadata as Record<string, unknown>).sarAnswer === true;
}

function toMessageDto(message: {
  id: string;
  role: string;
  kind: string;
  content: string;
  metadata: string | null;
  createdAt: Date;
}): ChatMessageDto {
  return {
    id: message.id,
    role: message.role,
    kind: message.kind,
    content: message.role === "assistant" ? stripUiInstructions(message.content) : message.content,
    metadata: parseMetadata(message.metadata),
    createdAt: message.createdAt.toISOString(),
  };
}
