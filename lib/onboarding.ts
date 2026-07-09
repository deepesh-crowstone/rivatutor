import { intentQuestionAfterLevel } from "@/lib/cefr-copy";
import { CEFR_LEVELS, type CefrLevel } from "@/lib/domain";
import { prisma } from "@/lib/db";
import { loadRecentConversation, updateProfileFromConversation } from "@/lib/profile-pipeline";
import { getAppState, requireActiveLearner } from "@/lib/state";
import { extractNameFromAnswer, extractUserInfo } from "@/lib/user-extraction";

const RECENT_MESSAGE_LIMIT = 8;

export function parseCefrLevel(text: string): CefrLevel | null {
  const normalized = text.trim().toUpperCase();
  const match = normalized.match(/\b(A1|A2|B1|B2|C1|C2)\b/);
  if (match) {
    return match[1] as CefrLevel;
  }

  return CEFR_LEVELS.includes(normalized as CefrLevel) ? (normalized as CefrLevel) : null;
}

export async function ensureWelcomeMessage(learnerId: string, name: string | null) {
  if (name) {
    return;
  }

  const messageCount = await prisma.chatMessage.count({ where: { learnerId } });
  if (messageCount > 0) {
    return;
  }

  await prisma.chatMessage.create({
    data: {
      learnerId,
      role: "assistant",
      kind: "profile_name_question",
      content: "Namaste! Main Riva hoon, aapki spoken English partner. Aapka naam kya hai?",
    },
  });
}

async function resolveLearnerLevel(answer: string): Promise<CefrLevel> {
  const parsed = parseCefrLevel(answer);
  if (parsed) {
    return parsed;
  }

  try {
    const extracted = await extractUserInfo({
      userMessage: answer,
      extractionGoal: "level",
    });
    if (extracted.level) {
      return extracted.level;
    }
  } catch {
    // Fall through to validation error below.
  }

  throw new Error("Riva ko apna level batayein: A1, A2, B1, B2, C1, ya C2.");
}

export async function submitOnboardingAnswer(answer: string) {
  const learner = await requireActiveLearner();
  const trimmed = answer.trim();

  if (!trimmed) {
    throw new Error("Riva ko apna jawab batayein taaki woh aage badh sake.");
  }

  if (!learner.name) {
    const conversationSoFar = await loadRecentConversation(learner.id, RECENT_MESSAGE_LIMIT);
    const nameResult = await extractNameFromAnswer({
      answer: trimmed,
      conversationSoFar,
    });

    await prisma.chatMessage.create({
      data: {
        learnerId: learner.id,
        role: "user",
        kind: "profile_name_answer",
        content: trimmed,
      },
    });

    if (!nameResult.nameProvided || !nameResult.name) {
      await prisma.chatMessage.create({
        data: {
          learnerId: learner.id,
          role: "assistant",
          kind: "profile_name_question",
          content: nameResult.followUpQuestion ?? "Aapka naam samajh nahi aaya. Main aapko kya bulaoon?",
        },
      });

      return getAppState();
    }

    await prisma.learnerProfile.update({
      where: { id: learner.id },
      data: { name: nameResult.name },
    });
    await prisma.chatMessage.create({
      data: {
        learnerId: learner.id,
        role: "assistant",
        kind: "profile_level_question",
        content: `Nice to meet you ${nameResult.name}. Main aapki English improve karne mein help karungi. Usse pehle mujhe aapka current English level batayein, taaki uske hisaab se main aapse baat kar saku.`,
      },
    });

    return getAppState();
  }

  if (!learner.selfDeclaredLevel) {
    const level = await resolveLearnerLevel(trimmed);

    await prisma.chatMessage.create({
      data: {
        learnerId: learner.id,
        role: "user",
        kind: "profile_level_answer",
        content: level,
      },
    });
    await prisma.learnerProfile.update({
      where: { id: learner.id },
      data: { selfDeclaredLevel: level },
    });
    await prisma.chatMessage.create({
      data: {
        learnerId: learner.id,
        role: "assistant",
        kind: "intent_question",
        content: intentQuestionAfterLevel(level),
      },
    });
    // Profile enrichment must never block onboarding UI progression.
    void updateProfileFromConversation(learner.id).catch(() => {
      // Best-effort background enrichment.
    });

    return getAppState();
  }

  throw new Error("Your profile is already set up.");
}
