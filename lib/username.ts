import { buildWelcomeBackMessageForLevel } from "@/lib/cefr-copy";
import { prisma } from "@/lib/db";
import { parseJsonArray } from "@/lib/json";
import { ensureWelcomeMessage } from "@/lib/onboarding";
import { clearActiveUsername, setActiveUsername } from "@/lib/session";
import { getAppState } from "@/lib/state";
import { parseUsernameInput } from "@/lib/username-rules";

export function buildWelcomeBackMessage(learner: {
  name: string | null;
  username: string;
  selfDeclaredLevel: string | null;
  intentSummary: string | null;
  userInterests: string;
  extractedKeyFacts: string;
}): string {
  return buildWelcomeBackMessageForLevel({
    name: learner.name,
    username: learner.username,
    selfDeclaredLevel: learner.selfDeclaredLevel,
    intentSummary: learner.intentSummary,
    interests: parseJsonArray(learner.userInterests),
    keyFacts: parseJsonArray(learner.extractedKeyFacts),
  });
}
async function ensureReturningWelcome(learnerId: string) {
  const learner = await prisma.learnerProfile.findUnique({ where: { id: learnerId } });
  if (!learner || !learner.name) {
    return;
  }

  const recent = await prisma.chatMessage.findFirst({
    where: { learnerId, kind: "welcome_back" },
    orderBy: { createdAt: "desc" },
  });
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  if (recent && recent.createdAt > fiveMinutesAgo) {
    return;
  }

  await prisma.chatMessage.create({
    data: {
      learnerId,
      role: "assistant",
      kind: "welcome_back",
      content: buildWelcomeBackMessage(learner),
    },
  });
}

export async function submitUsername(rawUsername: string) {
  const username = parseUsernameInput(rawUsername);
  let learner = await prisma.learnerProfile.findUnique({ where: { username } });
  const isNew = !learner;

  if (!learner) {
    learner = await prisma.learnerProfile.create({
      data: {
        username,
        progress: { create: {} },
      },
    });
  } else {
    await prisma.learnerProgress.upsert({
      where: { learnerId: learner.id },
      update: {},
      create: { learnerId: learner.id },
    });
  }

  await setActiveUsername(username);

  if (isNew) {
    await ensureWelcomeMessage(learner.id, learner.name);
  } else {
    await ensureReturningWelcome(learner.id);
  }

  return getAppState();
}

export async function resetSession() {
  await clearActiveUsername();
  return getAppState();
}
