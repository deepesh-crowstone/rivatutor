import { resolveHinglishCompositionBand, type HinglishCompositionBand } from "@/lib/content";

type BandCopy = Record<HinglishCompositionBand, string>;

function pick(level: string | null | undefined, copy: BandCopy): string {
  return copy[resolveHinglishCompositionBand(level)];
}

/** After intent is clear and curriculum topics are ready. */
export function topicSuggestionMessage(level?: string | null): string {
  return pick(level, {
    support_heavy:
      "Bahut badhiya! Maine aapke liye personalized topic sequence banayi hai. Neeche se topic chuno ya bolo kya practice karna hai.",
    balanced:
      "Great! Maine aapke goals ke hisaab se ek personalized topic sequence banayi hai. Neeche se topic chuno, ya bolo kya practice karna hai.",
    english_leaning:
      "Great — I've put together a personalized topic sequence for you. Pick a topic below, or tell me what you'd like to practice.",
  });
}

/** UI label above the topic suggestion cards. */
export function topicSuggestionsUiLabel(level?: string | null): string {
  return pick(level, {
    support_heavy: "Neeche se topic chuno ya bolo kya practice karna hai.",
    balanced: "Neeche se topic chuno, ya bolo kya practice karna hai.",
    english_leaning: "Pick a topic below, or tell me what you'd like to practice.",
  });
}

/** After CEFR level is captured — ask for learning intent. */
export function intentQuestionAfterLevel(level?: string | null): string {
  return pick(level, {
    support_heavy:
      "Bahut badhiya! Main aapko simple steps mein English bolna sikhaungi. Pehle mujhe yeh batayein — aap English kyun seekhna chahte hain?",
    balanced:
      "Bahut badhiya! Main aapki spoken English improve karne mein help karungi. Pehle bataiye — aap English kyun seekhna chahte hain?",
    english_leaning:
      "Great. I'll help you sharpen your spoken English. First — why do you want to improve your English?",
  });
}

/** Fallback when intent clarity LLM returns no follow-up. */
export function intentFollowUpFallback(level?: string | null): string {
  return pick(level, {
    support_heavy: "Ek real situation batayein jahan aap English better bolna chahte hain.",
    balanced: "Ek real situation bataiye jahan aap better English bolna chahte hain.",
    english_leaning: "Tell me one real situation where you want to speak English more confidently.",
  });
}

/** Mid-lesson topic change when the new topic is vague. */
export function topicChangeClarifyMessage(level?: string | null): string {
  return pick(level, {
    support_heavy:
      "Theek hai, topic change karte hain. Aap kya practice karna chahte ho? Neeche se topic chuno ya bolo kya seekhna hai.",
    balanced:
      "Theek hai, topic change karte hain. Kya practice karna chahte ho? Neeche se chuno ya bolo.",
    english_leaning:
      "Sure — let's switch topics. What would you like to practice? Pick below, or tell me.",
  });
}

/** Mid-lesson topic change when a concrete title is known. */
export function topicChangeAckWithTitle(title: string, level?: string | null): string {
  const safe = title.trim() || "this topic";
  return pick(level, {
    support_heavy: `Theek hai, ab hum "${safe}" practice karenge.`,
    balanced: `Theek hai — ab hum "${safe}" practice karenge.`,
    english_leaning: `Alright — let's practice "${safe}" next.`,
  });
}

/** After a topic finishes. */
export function topicCompleteMessage(level?: string | null): string {
  return pick(level, {
    support_heavy: "Topic complete ho gaya. Agla topic bataiye jise practice karna hai.",
    balanced: "Topic complete ho gaya. Agla topic bataiye jo practice karna hai.",
    english_leaning: "That topic's done. Tell me the next one you'd like to practice.",
  });
}

/** Returning-user welcome (parts joined with spaces). */
export function buildWelcomeBackMessageForLevel(learner: {
  name: string | null;
  username: string;
  selfDeclaredLevel: string | null;
  intentSummary: string | null;
  interests: string[];
  keyFacts: string[];
}): string {
  const displayName = learner.name ?? learner.username;
  const band = resolveHinglishCompositionBand(learner.selfDeclaredLevel);
  const parts: string[] = [];

  if (band === "english_leaning") {
    parts.push(`Welcome back, ${displayName}!`);
    if (learner.selfDeclaredLevel) {
      parts.push(`You're at ${learner.selfDeclaredLevel}.`);
    }
    if (learner.intentSummary) {
      parts.push(`Your goal: ${learner.intentSummary}.`);
    }
    if (learner.interests.length > 0) {
      parts.push(`I remember you like ${learner.interests.slice(0, 3).join(", ")}.`);
    }
    if (learner.keyFacts.length > 0) {
      parts.push(learner.keyFacts.slice(0, 2).join(" "));
    }
    parts.push("What would you like to practice today, or shall we pick up where we left off?");
    return parts.join(" ");
  }

  if (band === "balanced") {
    parts.push(`Welcome back, ${displayName}!`);
    if (learner.selfDeclaredLevel) {
      parts.push(`Aapka level ${learner.selfDeclaredLevel} hai.`);
    }
    if (learner.intentSummary) {
      parts.push(`Aapka goal: ${learner.intentSummary}.`);
    }
    if (learner.interests.length > 0) {
      parts.push(`Mujhe yaad hai aapko ${learner.interests.slice(0, 3).join(", ")} pasand hai.`);
    }
    if (learner.keyFacts.length > 0) {
      parts.push(learner.keyFacts.slice(0, 2).join(" "));
    }
    parts.push("Aaj kya practice karna chahte hain, ya jahan chhoda tha wahan se continue karein?");
    return parts.join(" ");
  }

  parts.push(`Wapas aaye aap, ${displayName}!`);
  if (learner.selfDeclaredLevel) {
    parts.push(`Aapka level ${learner.selfDeclaredLevel} hai.`);
  }
  if (learner.intentSummary) {
    parts.push(`Aapka goal: ${learner.intentSummary}.`);
  }
  if (learner.interests.length > 0) {
    parts.push(`Mujhe yaad hai aapko ${learner.interests.slice(0, 3).join(", ")} pasand hai.`);
  }
  if (learner.keyFacts.length > 0) {
    parts.push(learner.keyFacts.slice(0, 2).join(" "));
  }
  parts.push("Aaj kya practice karna chahte hain, ya jahan chhoda tha wahan se shuru karein?");
  return parts.join(" ");
}
