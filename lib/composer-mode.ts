import type { AppState } from "@/lib/domain";

export type RecordingTarget = "onboarding" | "intent" | "topic" | "lesson";
export type ComposerMode = RecordingTarget | "blocked";

export function deriveComposerState(state: AppState | null) {
  const needsUsername = Boolean(state?.needsUsername);
  const needsName = !needsUsername && !state?.profile.name;
  const needsLevel = Boolean(!needsUsername && state?.profile.name && !state.profile.selfDeclaredLevel);
  const needsOnboarding = needsName || needsLevel;
  const awaitingIntentCapture = Boolean(
    state?.profile.intentClarityStatus === "unknown" || state?.profile.intentClarityStatus === "probing",
  );
  const needsIntent = Boolean(
    !needsUsername &&
      state?.profile.name &&
      state.profile.selfDeclaredLevel &&
      awaitingIntentCapture &&
      state.topics.length === 0,
  );
  const hasCurriculum = Boolean(state?.topics.length);
  const hasActiveTopic = Boolean(state?.activeTopic && state.currentStep);

  const composerMode: ComposerMode = needsOnboarding
    ? "onboarding"
    : needsIntent
      ? "intent"
      : hasCurriculum && !hasActiveTopic
        ? "topic"
        : state?.currentStep?.type === "question"
          ? "lesson"
          : "blocked";

  const micDisabled = needsLevel;

  return {
    needsUsername,
    needsName,
    needsLevel,
    needsOnboarding,
    needsIntent,
    hasCurriculum,
    hasActiveTopic,
    composerMode,
    micDisabled,
  };
}
