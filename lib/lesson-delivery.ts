import {
  fallbackGenericAdvance,
  fallbackOpenEndedAdvance,
  fallbackSarPassFeedback,
  fallbackSarRetryFeedback,
} from "@/lib/cefr-copy";
import type {
  LessonDeliveryResult,
  LessonPlanStepReference,
  LessonTurnKind,
  SarGradingContext,
} from "@/lib/domain";
import { SAR_QUESTION_PROMPT, stripUiInstructions } from "@/lib/content";
import { isSarPassingScore } from "@/lib/word-diff";

const OPEN_ENDED_ANSWER_CUE_PATTERNS: RegExp[] = [
  /\bapne words mein bata(?:ye|o|iye)\b[^.!?]*[.!?]?/gi,
  /\bjawab (?:dena|bata(?:ye|o|iye|na|do))\b[^.!?]*[.!?]?/gi,
  /\bmic(?:rophone)?(?:\s+on)?\s+(?:karke|dabao|use karke)\b[^.!?]*[.!?]?/gi,
];

const OPEN_ENDED_SCENARIO_SENTENCE_PATTERNS: RegExp[] = [
  /\bimagine karo\b[^.!?]*[.!?]?/gi,
  /\bsocho\b[^.!?]*[.!?]?/gi,
  /\bkaise\b[^.!?]*\?/gi,
  /\bkaise\b[^.!?]*(?:doge|karoge|karenge|bolenge|batoge)[^.!?]*[.!?]?/gi,
  /\b(?:batao|bataye|batana|batayein)\b[^.!?]*[.!?]?/gi,
];

const OPEN_ENDED_MAX_INTRO_CHARS = 80;

const SIGNIFICANT_WORD_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "your",
  "that",
  "this",
  "from",
  "are",
  "was",
  "have",
  "been",
  "ki",
  "ke",
  "ka",
  "ko",
  "se",
  "par",
  "mein",
  "hai",
  "hain",
  "tum",
  "aap",
  "hum",
  "ab",
  "ek",
  "yeh",
  "woh",
  "aur",
  "toh",
  "jab",
  "kya",
  "kaise",
  "apni",
  "apna",
  "apne",
  "wahan",
  "yahan",
  "real",
  "life",
  "scenario",
  "situation",
  "try",
  "karte",
  "karenge",
  "kijiye",
  "chaliye",
]);

const OPEN_ENDED_QUESTION_SETUP_FALLBACK = "Chaliye ab real life mein try karte hain.";
const SAR_QUESTION_SETUP_FALLBACK = "Chalo ek useful phrase practice karte hain.";

function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when step content likely previews a later SAR target sentence. */
export function contentOverlapsExpectedAnswer(content: string, expectedAnswer: string): boolean {
  const normalizedExpected = normalizeForComparison(expectedAnswer);
  if (!normalizedExpected) {
    return false;
  }

  const normalizedContent = normalizeForComparison(content);
  if (normalizedContent.includes(normalizedExpected)) {
    return true;
  }

  const expectedWords = normalizedExpected.split(" ").filter(Boolean);
  if (expectedWords.length === 0) {
    return false;
  }

  const contentWords = new Set(normalizedContent.split(" ").filter(Boolean));
  const matched = expectedWords.filter((word) => contentWords.has(word)).length;
  return matched / expectedWords.length >= 0.7;
}

function splitSentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** Topic-bearing words used to detect semantic overlap between intro and question prompt. */
export function getSignificantWords(text: string): Set<string> {
  const normalized = normalizeForComparison(text);
  return new Set(
    normalized
      .split(" ")
      .filter((word) => word.length > 3 && !SIGNIFICANT_WORD_STOP_WORDS.has(word)),
  );
}

/** True when a sentence shares enough topic words with the question prompt. */
export function sentenceSharesTopicWithPrompt(
  sentence: string,
  questionPrompt: string,
  threshold = 0.3,
): boolean {
  const promptWords = getSignificantWords(questionPrompt);
  if (promptWords.size === 0) {
    return false;
  }

  const sentenceWords = getSignificantWords(sentence);
  if (sentenceWords.size === 0) {
    return false;
  }

  const shared = [...sentenceWords].filter((word) => promptWords.has(word)).length;
  return shared / sentenceWords.size >= threshold;
}

/** Remove scenario/question phrasing that belongs only in the QUESTION card. */
export function stripOpenEndedScenarioPatterns(text: string): string {
  let cleaned = text;
  for (const pattern of OPEN_ENDED_SCENARIO_SENTENCE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  const kept = splitSentences(cleaned).filter((sentence) => !sentence.includes("?"));
  return collapseSpokenText(kept.join(" "));
}

/** Keep at most the first short sentence for open-ended setup. */
export function trimToFirstShortSentence(text: string, maxChars = OPEN_ENDED_MAX_INTRO_CHARS): string {
  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    return "";
  }

  const first = sentences[0]!;
  if (first.length <= maxChars) {
    return first;
  }

  const truncated = first.slice(0, maxChars).trim();
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated).trim();
}

/** Resolve the open-ended question prompt shown in the QUESTION card. */
export function resolveOpenEndedQuestionPrompt(
  step: Pick<LessonPlanStepReference, "content"> & { questionPrompt?: string | null },
): string {
  return stripUiInstructions(step.questionPrompt ?? step.content).trim();
}

/** Sanitize open-ended step_intro spoken text — brief setup only, never duplicate the card prompt. */
export function sanitizeOpenEndedStepIntroReply(spokenReply: string, questionPrompt: string): string {
  const prompt = stripUiInstructions(questionPrompt).trim();
  let cleaned = spokenReply.trim();

  if (prompt) {
    cleaned = stripQuestionPromptFromSpokenReply(cleaned, prompt);
  }

  cleaned = stripOpenEndedAnswerCues(cleaned);
  cleaned = stripOpenEndedScenarioPatterns(cleaned);

  const filtered = splitSentences(cleaned).filter((sentence) => {
    if (sentence.includes("?")) {
      return false;
    }

    if (prompt && sentenceSharesTopicWithPrompt(sentence, prompt)) {
      return false;
    }

    if (prompt && textsOverlapSubstantially(sentence, prompt, 0.35)) {
      return false;
    }

    return true;
  });

  cleaned = collapseSpokenText(filtered.join(" "));

  if (cleaned.length > OPEN_ENDED_MAX_INTRO_CHARS) {
    cleaned = trimToFirstShortSentence(cleaned);
  }

  if (prompt && cleaned && textsOverlapSubstantially(cleaned, prompt, 0.35)) {
    cleaned = "";
  }

  if (prompt && cleaned && sentenceSharesTopicWithPrompt(cleaned, prompt)) {
    cleaned = "";
  }

  return cleaned;
}

/** True when two texts share most of their meaningful words or one contains the other. */
export function textsOverlapSubstantially(a: string, b: string, threshold = 0.6): boolean {
  const normalizedA = normalizeForComparison(a);
  const normalizedB = normalizeForComparison(b);
  if (!normalizedA || !normalizedB) {
    return false;
  }

  if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) {
    return true;
  }

  const wordsA = new Set(normalizedA.split(" ").filter((word) => word.length > 2));
  const wordsB = normalizedB.split(" ").filter((word) => word.length > 2);
  if (wordsB.length === 0) {
    return false;
  }

  const matched = wordsB.filter((word) => wordsA.has(word)).length;
  return matched / wordsB.length >= threshold;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collapseSpokenText(text: string): string {
  return text.replace(/\s{2,}/g, " ").replace(/\s+([.!?,;:])/g, "$1").trim();
}

/** Remove answer CTAs that belong only in the QUESTION card for open-ended steps. */
export function stripOpenEndedAnswerCues(text: string): string {
  let cleaned = text;
  for (const pattern of OPEN_ENDED_ANSWER_CUE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  return collapseSpokenText(cleaned);
}

/** Drop question-card prompt text duplicated in spoken setup. */
export function stripQuestionPromptFromSpokenReply(spokenReply: string, questionPrompt: string): string {
  const prompt = stripUiInstructions(questionPrompt).trim();
  if (!prompt) {
    return spokenReply.trim();
  }

  let cleaned = spokenReply.trim();
  const promptPattern = new RegExp(escapeRegExp(prompt), "i");
  if (promptPattern.test(cleaned)) {
    cleaned = cleaned.replace(promptPattern, "");
  }

  const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [cleaned];
  const kept = sentences
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && !textsOverlapSubstantially(sentence, prompt));

  return collapseSpokenText(kept.join(" "));
}

function stripSarTargetFromSpokenReply(
  spokenReply: string,
  step: Pick<LessonPlanStepReference, "content" | "expectedAnswer">,
): string {
  let cleaned = spokenReply;
  const referenceText = stripUiInstructions(step.content);

  if (step.expectedAnswer?.trim()) {
    const expectedPattern = new RegExp(escapeRegExp(step.expectedAnswer.trim()), "gi");
    cleaned = cleaned.replace(expectedPattern, "");
  }

  cleaned = cleaned.replace(
    /\b(?:repeat after me|say this with me|say this aloud|ye sentence repeat kijiye|isko repeat karein)\s*:?\s*[^.!?]*[.!?]?/gi,
    "",
  );
  cleaned = stripQuestionPromptFromSpokenReply(cleaned, referenceText);
  cleaned = stripQuestionPromptFromSpokenReply(cleaned, SAR_QUESTION_PROMPT);

  const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [cleaned];
  const kept = sentences
    .map((sentence) => sentence.trim())
    .filter((sentence) => {
      if (!sentence) {
        return false;
      }

      if (step.expectedAnswer && contentOverlapsExpectedAnswer(sentence, step.expectedAnswer)) {
        return false;
      }

      return true;
    });

  return collapseSpokenText(kept.join(" "));
}

/** Keep question step intros to brief Hinglish setup — never duplicate the QUESTION card prompt. */
export function sanitizeQuestionStepIntroReply(
  step: Pick<LessonPlanStepReference, "type" | "questionType" | "content" | "expectedAnswer">,
  spokenReply: string,
): string {
  if (step.type !== "question") {
    return spokenReply.trim();
  }

  let cleaned = spokenReply.trim();
  const questionPrompt = stripUiInstructions(step.content);

  if (step.questionType === "open_ended") {
    cleaned = sanitizeOpenEndedStepIntroReply(cleaned, questionPrompt);
    return cleaned || (questionPrompt.trim() ? "" : OPEN_ENDED_QUESTION_SETUP_FALLBACK);
  }

  if (step.questionType === "sar") {
    cleaned = stripSarTargetFromSpokenReply(cleaned, step);
    return cleaned || SAR_QUESTION_SETUP_FALLBACK;
  }

  return cleaned;
}

/** True when the next lesson step is a SAR or open-ended question. */
export function isUpcomingQuestionStep(
  nextStep: Pick<LessonPlanStepReference, "type"> | null | undefined,
): boolean {
  return nextStep?.type === "question";
}

/** Auto-chain step intros for teaching steps (concept/practice/recap) without waiting for the learner. */
export function shouldChainStepIntro(step: Pick<LessonPlanStepReference, "type">): boolean {
  return step.type === "concept" || step.type === "practice" || step.type === "recap";
}

/** Skip concept/practice intros only when they duplicate the next question's SAR target. */
export function shouldSkipStepIntro(
  step: Pick<LessonPlanStepReference, "type" | "content">,
  nextStep: Pick<LessonPlanStepReference, "type" | "questionType" | "content" | "expectedAnswer"> | null,
): boolean {
  if (!nextStep || (step.type !== "concept" && step.type !== "practice")) {
    return false;
  }

  if (nextStep.type !== "question") {
    return false;
  }

  if (nextStep.questionType === "sar" && nextStep.expectedAnswer) {
    return contentOverlapsExpectedAnswer(step.content, nextStep.expectedAnswer);
  }

  if (step.type === "concept") {
    return contentOverlapsExpectedAnswer(step.content, nextStep.content);
  }

  return false;
}

export function resolveDeliverableStep(
  steps: LessonPlanStepReference[],
  startOrder: number,
): { step: LessonPlanStepReference; skippedOrders: number[] } {
  const skippedOrders: number[] = [];
  let order = startOrder;

  while (true) {
    const currentIndex = steps.findIndex((step) => step.order === order);
    if (currentIndex === -1) {
      const fallback = steps[0];
      if (!fallback) {
        throw new Error("Lesson plan has no steps.");
      }
      return { step: fallback, skippedOrders };
    }

    const current = steps[currentIndex]!;
    const next = steps[currentIndex + 1] ?? null;
    if (next && shouldSkipStepIntro(current, next)) {
      skippedOrders.push(current.order);
      order = next.order;
      continue;
    }

    return { step: current, skippedOrders };
  }
}

export function resolveStepIntroAssistantKind(
  step: Pick<LessonPlanStepReference, "type">,
): string {
  return step.type === "question" ? "question" : step.type;
}

export function formatLessonPlanForPrompt(steps: LessonPlanStepReference[]): string {
  return JSON.stringify(
    steps.map((step) => ({
      order: step.order,
      type: step.type,
      questionType: step.questionType ?? undefined,
      content: step.content,
      questionPrompt: step.questionPrompt ?? undefined,
      expectedAnswer: step.expectedAnswer ?? undefined,
    })),
    null,
    2,
  );
}

export function formatRecentConversation(
  messages: Array<{ role: string; content: string }>,
  limit = 12,
): string {
  return messages
    .slice(-limit)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
}

export function resolveAssistantMessageKind(
  step: Pick<LessonPlanStepReference, "type" | "questionType">,
  turnKind: LessonTurnKind,
): string {
  if (turnKind === "step_intro") {
    return step.type;
  }

  if (step.type === "question" && step.questionType === "sar") {
    return "sar_feedback";
  }

  if (step.type === "question") {
    return "feedback";
  }

  return step.type;
}

export function shouldPersistLessonAnswerUserMessage(
  step: Pick<LessonPlanStepReference, "type" | "questionType">,
): boolean {
  return !(step.type === "question" && step.questionType === "sar");
}

export function shouldCreateSarRetryQuestionCard(
  delivery: Pick<LessonDeliveryResult, "reteach_current_step">,
  step: Pick<LessonPlanStepReference, "type" | "questionType">,
): boolean {
  return Boolean(delivery.reteach_current_step && step.type === "question" && step.questionType === "sar");
}

const GRAMMAR_TEACHING_MARKERS =
  /\b(ka matlab|matlab hota|word order|subject|verb|tense|article|preposition|polite form|pattern|structure|isliye|pehle|phir|question banane|sentence banane|grammar|formal|location ke liye)\b/i;

/** Pull Hinglish sentences that explain grammar from step reference content. */
export function extractGrammarTeachingLines(content: string): string[] {
  const cleaned = stripUiInstructions(content);
  const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [cleaned];

  return sentences
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && GRAMMAR_TEACHING_MARKERS.test(sentence));
}

function stripModelEnglishSentences(text: string): string {
  let cleaned = text.replace(
    /\b(?:aap keh sakte hain|you can say|repeat after me|say this|listen)\s*:\s*[^.!?]*[.!?]?/gi,
    "",
  );

  const hinglishMarkers =
    /\b(karte|karti|karna|hai|hain|aap|aapko|mein|par|ke liye|boliye|samjhte|waqt|kaise|chaliye|kijiye|samajhte)\b/i;
  const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [cleaned];
  const kept = sentences
    .map((sentence) => sentence.trim())
    .filter((sentence) => {
      if (!sentence) {
        return false;
      }

      if (hinglishMarkers.test(sentence)) {
        return true;
      }

      const words = sentence.match(/\b[\w']+\b/g) ?? [];
      if (words.length === 0) {
        return true;
      }

      const asciiWords = words.filter((word) => /^[a-zA-Z]+(?:'[a-z]+)?$/.test(word));
      return asciiWords.length / words.length < 0.75;
    });

  return kept.join(" ").replace(/\s{2,}/g, " ").trim();
}

function buildStepIntroSpokenReply(step: LessonPlanStepReference): string {
  const referenceText = stripUiInstructions(step.content);

  if (step.type === "recap") {
    return referenceText;
  }

  if (step.type === "concept") {
    const hinglishOnly = stripModelEnglishSentences(referenceText);
    if (hinglishOnly) {
      return hinglishOnly;
    }

    const grammarLines = extractGrammarTeachingLines(referenceText);
    if (grammarLines.length > 0) {
      return grammarLines.join(" ");
    }

    return "Chaliye is situation ko samajhte hain — English ka pattern kaise kaam karta hai, woh dekhte hain.";
  }

  if (step.type === "practice") {
    const hinglishOnly = stripModelEnglishSentences(referenceText);
    if (hinglishOnly) {
      return hinglishOnly;
    }

    const grammarLines = extractGrammarTeachingLines(referenceText);
    if (grammarLines.length > 0) {
      return `${grammarLines.join(" ")} Chaliye thodi guided practice karte hain.`;
    }

    return "Chaliye thodi guided practice karte hain.";
  }

  if (step.type === "question" && step.questionType === "sar") {
    return stripSarSetupText(referenceText);
  }

  if (step.type === "question" && step.questionType === "open_ended") {
    return OPEN_ENDED_QUESTION_SETUP_FALLBACK;
  }

  return referenceText;
}

function stripSarSetupText(text: string): string {
  const withoutCue = text
    .replace(/^(repeat after me|say this with me|say this aloud|ye sentence repeat kijiye|isko repeat karein)\s*:?\s*/i, "")
    .trim();
  const sentenceOnly = withoutCue.match(/^[^.!?]+[.!?]/)?.[0]?.trim();
  if (sentenceOnly && sentenceOnly.length >= withoutCue.length * 0.6) {
    return "Chalo ek useful phrase practice karte hain.";
  }

  return withoutCue || "Chalo ek useful phrase practice karte hain.";
}

export function buildFallbackLessonDelivery(input: {
  step: LessonPlanStepReference;
  turnKind: LessonTurnKind;
  nextStep?: Pick<LessonPlanStepReference, "type"> | null;
  sarGrading?: SarGradingContext;
  level?: string | null;
}): LessonDeliveryResult {
  if (input.turnKind === "step_intro") {
    const spokenReply =
      input.step.type === "question"
        ? sanitizeQuestionStepIntroReply(input.step, buildStepIntroSpokenReply(input.step))
        : buildStepIntroSpokenReply(input.step);

    return {
      spoken_reply: spokenReply,
      advance_step: shouldChainStepIntro(input.step),
      reteach_current_step: false,
    };
  }

  if (input.step.type === "question" && input.step.questionType === "sar" && input.sarGrading) {
    const passed = isSarPassingScore(input.sarGrading.score);
    const feedback = passed
      ? fallbackSarPassFeedback(
          input.sarGrading.correctCount,
          input.sarGrading.expectedCount,
          input.level,
        )
      : fallbackSarRetryFeedback(
          input.sarGrading.correctCount,
          input.sarGrading.expectedCount,
          input.level,
        );
    return {
      spoken_reply: feedback,
      advance_step: passed,
      reteach_current_step: !passed,
    };
  }

  if (input.step.type === "question") {
    return {
      spoken_reply: fallbackOpenEndedAdvance(input.level),
      advance_step: true,
      reteach_current_step: false,
    };
  }

  return {
    spoken_reply: fallbackGenericAdvance(input.level),
    advance_step: true,
    reteach_current_step: false,
  };
}

export function shouldAdvanceAfterDelivery(delivery: LessonDeliveryResult): boolean {
  return delivery.advance_step && !delivery.reteach_current_step;
}
