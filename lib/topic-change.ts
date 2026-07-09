export type TopicChangeDetection = {
  wantsChange: boolean;
  /** When true, the learner named a concrete replacement topic. */
  topicClear: boolean;
  /** Normalized freeform title when a concrete topic was named. */
  newTopicTitle: string | null;
  /** Heuristic confidence: strong skips LLM; soft may consult LLM. */
  confidence: "strong" | "soft" | "none";
};

const STRONG_CHANGE_PATTERNS: RegExp[] = [
  /\bchange(?:\s+the)?\s+topic\b/i,
  /\btopic\s+change\b/i,
  /\bnew\s+topic\b/i,
  /\bswitch(?:\s+the)?\s+topic\b/i,
  /\bswitch\s+to\b/i,
  /\bdifferent\s+topic\b/i,
  /\banother\s+topic\b/i,
  /\btopic\s+badlo\b/i,
  /\btopic\s+change\s+karo\b/i,
  /\bkuch\s+aur\b/i,
  /\bsomething\s+else\b/i,
  /\blet'?s\s+do\s+something\s+else\b/i,
  /\blet'?s\s+do\s+something\s+different\b/i,
  /\biske\s+bajaye\b/i,
  /\b(?:learn|practice|do|study)\s+.+\s+instead\b/i,
  /\binstead\s+(?:of\s+this|please)?\b/i,
  /\bstop\s+this\s+topic\b/i,
  /\bleave\s+this\s+topic\b/i,
  /\bhum\s+topic\s+change\b/i,
];

/** Explicit "let's practice/do/learn X" — strong when X differs from the active topic. */
const LETS_PRACTICE_PATTERN =
  /\b(?:let'?s|lets|shall\s+we|can\s+we|we\s+should)\s+(?:do|learn|practice|study|try|cover|work\s+on)\s+(.+)$/i;

/** "I wanna / I want to practice X" — strong when X differs from the active topic. */
const WANT_TO_PRACTICE_PATTERN =
  /\b(?:i\s+)?(?:wanna|want\s+to|want\s+a|would\s+like\s+to|id\s+like\s+to|i'?d\s+like\s+to)\s+(?:do|learn|practice|study|try|cover|work\s+on)\s+(.+)$/i;

const TITLE_EXTRACTION_PATTERNS: RegExp[] = [
  /\b(?:new\s+topic|topic)\s*[:\-]\s*(.+)$/i,
  /\b(?:change|switch)\s+(?:the\s+)?topic\s+to\s+(.+)$/i,
  /\b(?:i\s+want\s+to\s+learn|want\s+to\s+learn|learn)\s+about\s+(.+?)(?:\s+instead)?$/i,
  LETS_PRACTICE_PATTERN,
  WANT_TO_PRACTICE_PATTERN,
  /\b(?:practice|study)\s+(.+)$/i,
  /\b(?:ab|chalo|chaliye)\s+(.+?)\s+(?:seekhte|karte|practice)\b/i,
  /\binstead\s+(?:of\s+this[,.]?\s*)?(?:let'?s\s+)?(?:do|learn|practice)?\s*(.+)$/i,
  /\biske\s+bajaye\s+(.+)$/i,
];

const SOFT_LEARN_ABOUT_PATTERN =
  /\b(?:i\s+want\s+to\s+learn|want\s+to\s+learn|can\s+we\s+learn|can\s+we\s+do|can\s+we\s+practice)\s+(?:about\s+)?(.+)$/i;

const VAGUE_TOPIC_TITLES = new Set([
  "something else",
  "something different",
  "kuch aur",
  "another topic",
  "different topic",
  "new topic",
  "this",
  "that",
  "it",
  "else",
]);

const NOISE_TITLE_PREFIXES =
  /^(?:about|the|a|an|some|please|pls|ji|na|toh|to|ab|chalo|chaliye)\s+/i;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeTopicKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanExtractedTitle(raw: string): string | null {
  let title = normalizeWhitespace(raw);
  title = title.replace(/[.!?]+$/g, "").trim();
  title = title.replace(NOISE_TITLE_PREFIXES, "").trim();
  title = title.replace(/\b(?:instead|please|pls|ji|na)$/i, "").trim();
  title = title.replace(/^["'`]+|["'`]+$/g, "").trim();

  if (!title || title.length < 2) {
    return null;
  }

  const key = normalizeTopicKey(title);
  if (!key || VAGUE_TOPIC_TITLES.has(key)) {
    return null;
  }

  // Reject answers that look like full spoken sentences answering a prompt.
  if (title.split(/\s+/).length > 12) {
    return null;
  }

  return title;
}

function extractTitle(utterance: string): string | null {
  const trimmed = normalizeWhitespace(utterance);
  for (const pattern of TITLE_EXTRACTION_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      const cleaned = cleanExtractedTitle(match[1]);
      if (cleaned) {
        return cleaned;
      }
    }
  }

  const soft = trimmed.match(SOFT_LEARN_ABOUT_PATTERN);
  if (soft?.[1]) {
    return cleanExtractedTitle(soft[1]);
  }

  return null;
}

function topicsLikelySame(a: string, b: string): boolean {
  const left = normalizeTopicKey(a);
  const right = normalizeTopicKey(b);
  if (!left || !right) {
    return false;
  }
  return left === right || left.includes(right) || right.includes(left);
}

/**
 * Detect mid-lesson requests to abandon the current topic and switch.
 * Strong matches are safe to act on without an LLM; soft matches may need classification.
 */
export function detectTopicChangeIntent(
  utterance: string,
  currentTopicTitle?: string | null,
): TopicChangeDetection {
  const trimmed = normalizeWhitespace(utterance);
  if (!trimmed) {
    return { wantsChange: false, topicClear: false, newTopicTitle: null, confidence: "none" };
  }

  const strongHit = STRONG_CHANGE_PATTERNS.some((pattern) => pattern.test(trimmed));
  const extracted = extractTitle(trimmed);
  const softLearnHit = SOFT_LEARN_ABOUT_PATTERN.test(trimmed);
  const letsPracticeHit = LETS_PRACTICE_PATTERN.test(trimmed);
  const wantToPracticeHit = WANT_TO_PRACTICE_PATTERN.test(trimmed);
  const differentFromCurrent =
    Boolean(extracted) &&
    (!currentTopicTitle || !topicsLikelySame(extracted!, currentTopicTitle));

  if (strongHit) {
    const title = differentFromCurrent ? extracted : null;
    return {
      wantsChange: true,
      topicClear: Boolean(title),
      newTopicTitle: title,
      confidence: "strong",
    };
  }

  // "Let's practice X" / "I wanna practice X" while another topic is active —
  // treat as a strong switch so the LLM classifier cannot keep the old lesson.
  if ((letsPracticeHit || wantToPracticeHit) && differentFromCurrent) {
    return {
      wantsChange: true,
      topicClear: true,
      newTopicTitle: extracted,
      confidence: "strong",
    };
  }

  if (extracted && differentFromCurrent && softLearnHit) {
    return {
      wantsChange: true,
      topicClear: true,
      newTopicTitle: extracted,
      confidence: "soft",
    };
  }

  if (softLearnHit && differentFromCurrent) {
    return {
      wantsChange: true,
      topicClear: true,
      newTopicTitle: extracted,
      confidence: "soft",
    };
  }

  return { wantsChange: false, topicClear: false, newTopicTitle: null, confidence: "none" };
}

/** @deprecated Prefer `topicChangeClarifyMessage(level)` from `lib/cefr-copy`. */
export const TOPIC_CHANGE_CLARIFY_MESSAGE =
  "Theek hai, topic change karte hain. Aap kya practice karna chahte ho? Neeche se topic chuno ya bolo kya seekhna hai.";

/** @deprecated Prefer `topicChangeAckWithTitle(title, level)` from `lib/cefr-copy`. */
export const TOPIC_CHANGE_ACK_WITH_TITLE = (title: string) =>
  `Theek hai, ab hum "${title}" practice karenge.`;