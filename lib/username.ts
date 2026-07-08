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
  const displayName = learner.name ?? learner.username;
  const parts = [`Wapas aaye aap, ${displayName}!`];

  if (learner.selfDeclaredLevel) {
    parts.push(`Aapka level ${learner.selfDeclaredLevel} hai.`);
  }

  if (learner.intentSummary) {
    parts.push(`Aapka goal: ${learner.intentSummary}.`);
  }

  const interests = parseJsonArray(learner.userInterests);
  if (interests.length > 0) {
    parts.push(`Mujhe yaad hai aapko ${interests.slice(0, 3).join(", ")} pasand hai.`);
  }

  const keyFacts = parseJsonArray(learner.extractedKeyFacts);
  if (keyFacts.length > 0) {
    parts.push(keyFacts.slice(0, 2).join(" "));
  }

  parts.push("Aaj kya practice karna chahte hain, ya jahan chhoda tha wahan se shuru karein?");
  return parts.join(" ");
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
