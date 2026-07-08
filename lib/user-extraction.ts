import {
  userInfoExtractionSchema,
  type ExtractionGoal,
  type LearnerContextInput,
  type UserInfoExtraction,
} from "@/lib/domain";
import { callOpenRouterJson } from "@/lib/openrouter";

const DEFAULT_NAME_FOLLOW_UP = "Aapka naam samajh nahi aaya. Main aapko kya bulaoon?";

const INVALID_NAME_PHRASES = [
  /^my\s+name\s+is$/i,
  /^my\s+name'?s$/i,
  /^i\s+am$/i,
  /^i'?m$/i,
  /^im$/i,
  /^call\s+me$/i,
  /^this\s+is$/i,
  /^it'?s$/i,
  /^well$/i,
  /^hi$/i,
  /^hello$/i,
  /^hey$/i,
] as const;

const EXTRACTION_GOAL_INSTRUCTIONS: Record<ExtractionGoal, string> = {
  name: `Decide whether the learner actually provided their personal name in the conversation.
Set name_provided to true only when a real name is clearly given (e.g. "Dipesh", "John Smith").
Set name_provided to false when the learner only started an intro phrase without a name ("My name is", "I am", "Call me") or gave no name.
When name_provided is false, set name to null and provide a short spoken follow_up_question asking for their name in Hinglish.
Strip greetings and phrases like "my name is" — return only the bare name when provided.`,
  level: "Extract the learner's English CEFR level (A1, A2, B1, B2, C1, or C2) if stated or clearly implied.",
  intent:
    "Extract learning motivations, target situations, and interests related to spoken English. Populate interests and key_facts.",
};

export type NameExtractionResult = {
  name: string | null;
  nameProvided: boolean;
  followUpQuestion: string | null;
};

export function isInvalidExtractedName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) {
    return true;
  }

  const normalized = trimmed.toLowerCase().replace(/[.!?,;:]+$/g, "").trim();
  if (INVALID_NAME_PHRASES.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const withoutIntro = normalized
    .replace(/^(?:well|oh|hey|hi(?:\s+there)?|hello)[,!.]?\s*/i, "")
    .replace(/^(?:my\s+name\s*'?s|my\s+name\s+is)\s*/i, "")
    .replace(/^(?:i\s*'?m|i\s+am|im)\s*/i, "")
    .replace(/^call\s+me\s*/i, "")
    .replace(/^it\s*'?s\s*/i, "")
    .replace(/^this\s+is\s*/i, "")
    .trim();

  if (!withoutIntro) {
    return true;
  }

  const tokens = withoutIntro.split(/\s+/).filter((token) => /^[A-Za-z]{2,}/.test(token));
  return tokens.length === 0;
}

export function extractNameFallback(text: string): string | null {
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  if (!firstLine) {
    return null;
  }

  const match = firstLine.match(/(?:my\s+name\s+is|i\s*'?m|i\s+am|im)\s+([A-Za-z]{2,}(?:\s+[A-Za-z]{2,})?)/i);
  if (!match?.[1]) {
    return null;
  }

  const cleaned = cleanExtractedName(match[1]);
  return isInvalidExtractedName(cleaned) ? null : cleaned;
}

function cleanExtractedName(text: string): string {
  return text
    .replace(/^["']+|["']+$/g, "")
    .replace(/[.!?,;:]+$/g, "")
    .trim();
}

export function mergeExtractedArrays(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map((item) => item.toLowerCase()));
  const merged = [...existing];

  for (const item of incoming) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) {
      continue;
    }

    seen.add(trimmed.toLowerCase());
    merged.push(trimmed);
  }

  return merged;
}

export function buildLearnerContextBlock(
  profile: LearnerContextInput,
  options?: { recentConversation?: string },
): string {
  const lines: string[] = [];

  if (profile.name) {
    lines.push(`Learner name: ${profile.name}`);
  }
  if (profile.selfDeclaredLevel) {
    lines.push(`Level: ${profile.selfDeclaredLevel}`);
  }
  if (profile.userInterests?.length) {
    lines.push(`Interests: ${profile.userInterests.join(", ")}`);
  }
  if (profile.extractedKeyFacts?.length) {
    lines.push(`Key facts: ${profile.extractedKeyFacts.join("; ")}`);
  }
  if (profile.intentSummary) {
    lines.push(`Learning goal: ${profile.intentSummary}`);
  }
  if (profile.intentGoalContexts?.length) {
    lines.push(`Goal contexts: ${profile.intentGoalContexts.join(", ")}`);
  }
  if (profile.intentMotivation) {
    lines.push(`Motivation: ${profile.intentMotivation}`);
  }
  if (options?.recentConversation) {
    lines.push(`Recent conversation:\n${options.recentConversation}`);
  }

  if (lines.length === 0) {
    return "";
  }

  return `\n\nLearner context:\n${lines.join("\n")}`;
}

function nameExtractionPrompt(goal: ExtractionGoal): string {
  if (goal === "name") {
    return `Return JSON:
{
  "name": "bare first or full name, or null",
  "name_provided": true,
  "follow_up_question": null,
  "interests": [],
  "key_facts": [],
  "confidence": 0.0
}

When no real name was given:
{
  "name": null,
  "name_provided": false,
  "follow_up_question": "Hinglish mein chhota sawaal unka naam poochne ke liye",
  "interests": [],
  "key_facts": []
}`;
  }

  return `Return JSON:
{
  "name": "optional bare first name or full name",
  "level": "optional A1|A2|B1|B2|C1|C2",
  "interests": ["optional interest strings"],
  "key_facts": ["optional durable facts about the learner"],
  "confidence": 0.0
}`;
}

export async function extractUserInfo(input: {
  userMessage: string;
  conversationSoFar?: string;
  extractionGoal: ExtractionGoal;
}): Promise<UserInfoExtraction> {
  const conversationBlock = input.conversationSoFar
    ? `\nConversation so far:\n${input.conversationSoFar}\n`
    : "";

  return callOpenRouterJson(
    [
      {
        role: "system",
        content:
          "You are Riva's User-Info Extractor. Read the full conversation context and return structured JSON only. Never copy intro phrases into the name field. For name extraction, set name_provided false unless a real personal name is clearly given.",
      },
      {
        role: "user",
        content: `Extraction goal: ${input.extractionGoal}
${EXTRACTION_GOAL_INSTRUCTIONS[input.extractionGoal]}
${conversationBlock}
Latest learner message:
${input.userMessage}

${nameExtractionPrompt(input.extractionGoal)}`,
      },
    ],
    userInfoExtractionSchema,
  );
}

function normalizeNameExtraction(extracted: UserInfoExtraction): NameExtractionResult {
  const rawName = extracted.name ? cleanExtractedName(extracted.name) : "";
  const hasValidName = Boolean(rawName) && !isInvalidExtractedName(rawName);
  const nameProvided = extracted.name_provided === true && hasValidName;

  if (nameProvided && rawName) {
    return {
      name: rawName.slice(0, 80),
      nameProvided: true,
      followUpQuestion: null,
    };
  }

  if (extracted.name_provided === false) {
    return {
      name: null,
      nameProvided: false,
      followUpQuestion: extracted.follow_up_question?.trim() || DEFAULT_NAME_FOLLOW_UP,
    };
  }

  if (hasValidName && rawName) {
    return {
      name: rawName.slice(0, 80),
      nameProvided: true,
      followUpQuestion: null,
    };
  }

  return {
    name: null,
    nameProvided: false,
    followUpQuestion: extracted.follow_up_question?.trim() || DEFAULT_NAME_FOLLOW_UP,
  };
}

export async function extractNameFromAnswer(input: {
  answer: string;
  conversationSoFar?: string;
}): Promise<NameExtractionResult> {
  const trimmed = input.answer.trim();
  if (!trimmed) {
    return {
      name: null,
      nameProvided: false,
      followUpQuestion: DEFAULT_NAME_FOLLOW_UP,
    };
  }

  try {
    const extracted = await extractUserInfo({
      userMessage: trimmed,
      conversationSoFar: input.conversationSoFar,
      extractionGoal: "name",
    });
    const normalized = normalizeNameExtraction(extracted);
    if (normalized.nameProvided && normalized.name) {
      return normalized;
    }
    if (extracted.name_provided === false) {
      return normalized;
    }
  } catch {
    // Fall through to regex for clear patterns only.
  }

  const fallbackName = extractNameFallback(trimmed);
  if (fallbackName) {
    return {
      name: fallbackName.slice(0, 80),
      nameProvided: true,
      followUpQuestion: null,
    };
  }

  return {
    name: null,
    nameProvided: false,
    followUpQuestion: DEFAULT_NAME_FOLLOW_UP,
  };
}
