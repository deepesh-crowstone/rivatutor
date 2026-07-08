import {
  profileUpdateResultSchema,
  type ProfileUpdateResult,
} from "@/lib/domain";
import { prisma } from "@/lib/db";
import { parseJsonArray, stringifyJson } from "@/lib/json";
import { isInvalidExtractedName, mergeExtractedArrays } from "@/lib/user-extraction";
import { callOpenRouterJson } from "@/lib/openrouter";

const CONVERSATION_MESSAGE_LIMIT = 40;

const PROFILE_UPDATE_INSTRUCTIONS =
  "Review the full recent conversation and extract durable learner profile updates: hobbies/interests, key facts about their life or goals, any corrected display name, and an optional refined intent summary. Only include information clearly stated or strongly implied. Do not invent facts.";

export function mergeProfileUpdate(
  current: {
    name: string | null;
    userInterests: string[];
    extractedKeyFacts: string[];
    intentSummary: string | null;
  },
  update: ProfileUpdateResult,
): {
  name: string | null;
  userInterests: string[];
  extractedKeyFacts: string[];
  intentSummary: string | null;
} {
  const userInterests = mergeExtractedArrays(current.userInterests, update.interests ?? []);
  const extractedKeyFacts = mergeExtractedArrays(current.extractedKeyFacts, update.key_facts ?? []);

  let name = current.name;
  const incomingName = update.name?.trim();
  if (incomingName && !isInvalidExtractedName(incomingName)) {
    name = incomingName.slice(0, 80);
  }

  const intentSummary = update.intent_summary?.trim() || current.intentSummary;

  return {
    name,
    userInterests,
    extractedKeyFacts,
    intentSummary,
  };
}

export async function loadRecentConversation(
  learnerId: string,
  take = CONVERSATION_MESSAGE_LIMIT,
): Promise<string> {
  const messages = await prisma.chatMessage.findMany({
    where: { learnerId },
    orderBy: { createdAt: "desc" },
    take,
  });

  return [...messages]
    .reverse()
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
}

async function extractProfileUpdate(input: {
  userMessage: string;
  conversationSoFar: string;
}): Promise<ProfileUpdateResult> {
  return callOpenRouterJson(
    [
      {
        role: "system",
        content:
          "You are Riva's Profile Update Extractor. Read the full conversation and return structured JSON only. Never overwrite a valid name with an intro phrase.",
      },
      {
        role: "user",
        content: `Extraction goal: profile_update
${PROFILE_UPDATE_INSTRUCTIONS}

Conversation so far:
${input.conversationSoFar}

Latest learner message:
${input.userMessage}

Return JSON:
{
  "interests": ["new or reinforced interests"],
  "key_facts": ["durable facts about the learner"],
  "intent_summary": "optional refined learning-goal summary",
  "name": "optional corrected display name or null"
}`,
      },
    ],
    profileUpdateResultSchema,
  );
}

export async function updateProfileFromConversation(learnerId: string): Promise<void> {
  const learner = await prisma.learnerProfile.findUnique({ where: { id: learnerId } });
  if (!learner) {
    return;
  }

  const conversationSoFar = await loadRecentConversation(learnerId);
  if (!conversationSoFar) {
    return;
  }

  const latestUserMessage =
    conversationSoFar
      .split("\n")
      .reverse()
      .find((line) => line.startsWith("user: "))
      ?.replace(/^user:\s*/, "") ?? "";

  let update: ProfileUpdateResult;
  try {
    update = await extractProfileUpdate({
      userMessage: latestUserMessage,
      conversationSoFar,
    });
  } catch {
    // Profile enrichment is best-effort; skip this pass on LLM failure.
    return;
  }

  const merged = mergeProfileUpdate(
    {
      name: learner.name,
      userInterests: parseJsonArray(learner.userInterests),
      extractedKeyFacts: parseJsonArray(learner.extractedKeyFacts),
      intentSummary: learner.intentSummary,
    },
    update,
  );

  const currentInterests = parseJsonArray(learner.userInterests);
  const currentFacts = parseJsonArray(learner.extractedKeyFacts);
  const hasChanges =
    merged.name !== learner.name ||
    merged.userInterests.length !== currentInterests.length ||
    merged.extractedKeyFacts.length !== currentFacts.length ||
    merged.intentSummary !== learner.intentSummary;

  if (!hasChanges) {
    return;
  }

  await prisma.learnerProfile.update({
    where: { id: learnerId },
    data: {
      ...(merged.name !== learner.name ? { name: merged.name } : {}),
      userInterests: stringifyJson(merged.userInterests),
      extractedKeyFacts: stringifyJson(merged.extractedKeyFacts),
      ...(merged.intentSummary !== learner.intentSummary && merged.intentSummary
        ? { intentSummary: merged.intentSummary }
        : {}),
    },
  });
}
