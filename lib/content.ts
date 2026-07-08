/** Spoken-delivery rule injected into Riva-facing LLM prompts. */
export const RIVA_DELIVERY_RULE =
  "Never reference UI controls, buttons, taps, clicks, or app mechanics. Speak as a voice teacher in conversation only. Do not say tap, click, press, choose above, reply box, or similar.";

/** Standard Hinglish prompt shown on SAR question cards and spoken before the model sentence. */
export const SAR_QUESTION_PROMPT = "Is sentence ko repeat karein:";

/** Language rule for learner-facing Riva copy — Hinglish instructions, English teaching content. */
export const RIVA_LANGUAGE_RULE =
  "Write all explanations, questions (in prose), feedback, encouragement, and CTAs in natural Hinglish (Roman script, warm Indian classroom tone). Keep phrases to repeat, SAR expectedAnswer, and model English sentences in English only — but only on SAR question steps, never on concept/practice spoken intros. QUESTION card prompts are shown in the UI — the deliverer must not duplicate English question text in spoken_reply for question steps.";

/** Grammar teaching rule — explain WHY English works, not just what to say. */
export const RIVA_GRAMMAR_RULE =
  "Teach underlying English grammar, not just phrases. On concept and practice steps, include 1–2 short Hinglish grammar notes in step content (why the pattern works: tense, word order, subject–verb, polite forms, articles, prepositions, question structure). Keep notes spoken-friendly — one or two sentences, not textbook walls. Connect each rule to the learner's topic context (airport, travel, office, etc.). English only for example phrases; grammar labels may use Roman Hindi/English mix (verb, subject, tense). Match depth to CEFR: A1–A2 = simpler patterns; B1+ = slightly richer structure. Do NOT preview SAR target sentences on concept steps — explain the pattern without quoting the exact sentence the learner will repeat next.";

const UI_INSTRUCTION_PATTERNS: RegExp[] = [
  /\bwhen you(?:'re| are) ready,?\s*tap continue\b[^.!?]*[.!?]?/gi,
  /\btap continue\b[^.!?]*[.!?]?/gi,
  /\bpress continue\b[^.!?]*[.!?]?/gi,
  /\baage badhne ke liye\s+'?ready'?\s+boliye\.?/gi,
  /\bjab (?:aap )?taiyaar ho(?:\s+tab)?\s*,?\s*'?ready'?\s+boliye\.?/gi,
  /\bjab aap ready ho(?:\s+tab)?\s*,?\s*(?:toh\s+)?batana\.?/gi,
  /\bjab aap taiyaar ho(?:\s+tab)?\s*,?\s*(?:toh\s+)?batana\.?/gi,
  /\bready ho(?:\s+tab)?\s*,?\s*(?:toh\s+)?batana\.?/gi,
  /\bcontinue boliye\.?/gi,
  /\btap (?:the )?mic(?:rophone)?\b[^.!?]*[.!?]?/gi,
  /\bclick (?:here|there|on|the)\b[^.!?]*[.!?]?/gi,
  /\bchoose (?:a )?level above\b[^.!?]*[.!?]?/gi,
  /\bchoose (?:one )?(?:of the )?(?:suggested )?topics? above\b[^.!?]*[.!?]?/gi,
  /\bchoose above\b[^.!?]*[.!?]?/gi,
  /\breply (?:in the )?(?:chat|box)\b[^.!?]*[.!?]?/gi,
];

/** Strip legacy UI/meta instructions from stored or generated teaching text. */
export function stripUiInstructions(text: string): string {
  let cleaned = text;
  for (const pattern of UI_INSTRUCTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  return cleaned
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.!?,;:])/g, "$1")
    .trim();
}

/** Short phrases that mean "advance" on mic-only concept/practice steps. */
const CONTINUE_PHRASES = new Set([
  "continue",
  "next",
  "go on",
  "go ahead",
  "ok",
  "okay",
  "got it",
  "i'm ready",
  "im ready",
  "ready",
  "yes",
]);

export function isContinueAdvancePhrase(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, "");
  return CONTINUE_PHRASES.has(normalized);
}
