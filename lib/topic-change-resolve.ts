import type { TopicChangeIntentResult } from "@/lib/domain";
import {
  detectTopicChangeIntent,
  type TopicChangeDetection,
} from "@/lib/topic-change";

/** Map LLM classifier output into the app's topic-change detection shape. */
export function mapTopicChangeClassification(
  classified: TopicChangeIntentResult,
): TopicChangeDetection {
  if (!classified.wants_topic_change) {
    return { wantsChange: false, topicClear: false, newTopicTitle: null, confidence: "none" };
  }

  const title = classified.topic_clear ? classified.new_topic_title?.trim() || null : null;
  return {
    wantsChange: true,
    topicClear: Boolean(title),
    newTopicTitle: title,
    confidence: "llm",
  };
}

/**
 * Resolve topic-change intent: LLM first, heuristic only if the classifier fails.
 * `classify` should call `classifyTopicChangeIntent`.
 */
export async function resolveTopicChangeFromClassifier(input: {
  utterance: string;
  currentTopicTitle: string;
  classify: () => Promise<TopicChangeIntentResult>;
}): Promise<TopicChangeDetection> {
  const trimmed = input.utterance.trim();
  if (!trimmed) {
    return { wantsChange: false, topicClear: false, newTopicTitle: null, confidence: "none" };
  }

  try {
    return mapTopicChangeClassification(await input.classify());
  } catch {
    return detectTopicChangeIntent(trimmed, input.currentTopicTitle);
  }
}
