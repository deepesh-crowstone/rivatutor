import {
  curriculumSchema,
  getLessonPlanQuestionMix,
  intentClaritySchema,
  lessonDeliverySchema,
  lessonPlanSchemaForLevel,
  topicChangeIntentSchema,
  type CurriculumResult,
  type IntentClarityResult,
  type LessonDeliveryResult,
  type LessonPlanResult,
  type LessonPlanStepReference,
  type LessonTurnKind,
  type LearnerContextInput,
  type SarGradingContext,
  type TopicChangeIntentResult,
} from "@/lib/domain";
import {
  formatGrammarRuleForPrompt,
  formatLanguageRulesForPrompt,
  getDelivererLanguageOverride,
  getLessonPlanStructurePrompt,
  isEnglishOnlyLevel,
  RIVA_DELIVERY_RULE,
} from "@/lib/content";
import { formatLessonPlanForPrompt } from "@/lib/lesson-delivery";
import { callOpenRouterJson } from "@/lib/openrouter";
import { buildLearnerContextBlock } from "@/lib/user-extraction";

export async function judgeIntentClarity(input: {
  learnerAnswer: string;
  exchangeSoFar: string;
  probeCount: number;
  learnerContext?: LearnerContextInput;
}): Promise<IntentClarityResult> {
  const contextBlock = buildLearnerContextBlock(input.learnerContext ?? {});
  const level = input.learnerContext?.selfDeclaredLevel;
  const languageRules = formatLanguageRulesForPrompt(level);
  const followUpExample = isEnglishOnlyLevel(level)
    ? "a short friendly English follow-up question"
    : "ek chhota friendly Hinglish follow-up sawaal";
  return callOpenRouterJson(
    [
      {
        role: "system",
        content:
          `You are Riva's Intent Clarity Judge. Decide if the learner's reason for learning spoken English is specific enough to personalize a curriculum. Clear means you can name real situations such as interviews, work meetings, travel, client calls, presentations, daily conversation, or exams. ${RIVA_DELIVERY_RULE} ${languageRules} Follow-up questions must be spoken questions only, matching the CEFR language rule. Return only JSON.${contextBlock}`,
      },
      {
        role: "user",
        content: `Probe count so far: ${input.probeCount}. Max follow-ups: 2.

Conversation so far:
${input.exchangeSoFar}

Latest learner answer:
${input.learnerAnswer}

Return JSON in this shape:
{
  "clear": true,
  "structured_intent": {
    "summary": "short personalized summary",
    "goal_contexts": ["specific situation"],
    "motivation": "why it matters"
  }
}

If not clear and probe count is below 2, return:
{
  "clear": false,
  "follow_up_question": "${followUpExample}"
}

If not clear but probe count is already 2, set clear true and create the best-effort structured_intent from available context.`,
      },
    ],
    intentClaritySchema,
  );
}

export async function planCurriculum(input: {
  level: string;
  intentSummary: string;
  goalContexts: string[];
  motivation: string;
  learnerContext?: LearnerContextInput;
}): Promise<CurriculumResult> {
  const contextBlock = buildLearnerContextBlock(input.learnerContext ?? {});
  const languageRules = formatLanguageRulesForPrompt(input.level);
  return callOpenRouterJson(
    [
      {
        role: "system",
        content:
          `You are Riva's Curriculum Planner. Create an ordered spoken-English curriculum that moves from foundational comfort to the learner's target situations. ${RIVA_DELIVERY_RULE} ${languageRules} Topic titles and descriptions must match the CEFR language rule (Hinglish/bilingual for A1–B2; English only for C1–C2 — no Hindi). Return only JSON.${contextBlock}`,
      },
      {
        role: "user",
        content: `Learner level: ${input.level}
Intent summary: ${input.intentSummary}
Goal contexts: ${input.goalContexts.join(", ")}
Motivation: ${input.motivation}

Create 10 to 15 topics. Each topic must be practical, spoken-English focused, and sequenced from easier to harder.

Return JSON:
{
  "topics": [
    { "title": "topic title", "description": "what the learner will practice", "order": 1 }
  ]
}`,
      },
    ],
    curriculumSchema,
  );
}

export async function createLessonPlan(input: {
  topicTitle: string;
  topicDescription: string;
  level: string;
  intentSummary: string;
  goalContexts: string[];
  learnerContext?: LearnerContextInput;
}): Promise<LessonPlanResult> {
  const contextBlock = buildLearnerContextBlock(input.learnerContext ?? {});
  const languageRules = formatLanguageRulesForPrompt(input.level);
  const grammarRule = formatGrammarRuleForPrompt(input.level);
  const structurePrompt = getLessonPlanStructurePrompt(input.level);
  const mix = getLessonPlanQuestionMix(input.level);
  const noSar = mix.maxSar === 0;
  const requirementsBlock = noSar
    ? `- 8–12 steps total
- 2–3 concept, 0–1 practice (optional), 4–6 question steps that are **all open_ended** (≥${mix.minOpenEnded} open_ended), 1 recap (last)
- **Do NOT include any SAR / sentence-repeat questions** — they are too easy for C1–C2
- Open-ended prompts should invite extended speech: opinion, negotiation, problem-solving, persuasion`
    : `- 8–12 steps total
- 2–3 concept, 1–2 practice (optional), 4–6 question (≥${mix.minSar} SAR + ≥${mix.minOpenEnded} open_ended), 1 recap (last)
- SAR progression: full sentence → blanks → application via open_ended`;
  const exampleJson = noSar
    ? `{
  "steps": [
    { "type": "concept", "content": "At airport check-in, tone and clarity matter more than fixed phrases — keep requests polite but direct." },
    { "type": "concept", "content": "When something goes wrong (delay, missing seat), frame the issue, propose a solution, and stay calm." },
    { "type": "practice", "content": "Next you'll handle realistic check-in scenarios in your own words — no scripted repeats." },
    { "type": "question", "questionType": "open_ended", "content": "Brief setup.", "questionPrompt": "You're at check-in and your preferred seat is gone. Explain the problem and negotiate an alternative." },
    { "type": "question", "questionType": "open_ended", "content": "Brief setup.", "questionPrompt": "The agent seems rushed. How would you politely insist they recheck your booking details?" },
    { "type": "question", "questionType": "open_ended", "content": "Brief setup.", "questionPrompt": "Your flight is delayed and you have a tight connection. Persuade the agent to help you rebook." },
    { "type": "question", "questionType": "open_ended", "content": "Brief setup.", "questionPrompt": "Role-play: respond as if the agent offered a later flight you don't want — push back with a clear preference." },
    { "type": "recap", "content": "Today you practiced handling check-in problems with clear, confident spoken English — framing issues, negotiating, and staying polite under pressure." }
  ]
}`
    : `{
  "steps": [
    { "type": "concept", "content": "Airport check-in par hum politely apna passport dete hain. English mein 'here is' ka matlab hota hai 'yeh hai' — pehle cheez (subject), phir 'is' (verb). Yeh pattern formal situations mein common hai." },
    { "type": "concept", "content": "Immigration officer se baat karte waqt tone calm aur respectful rakhte hain. 'Good morning' se start karna professional lagta hai — yeh greeting formal settings mein safe choice hai." },
    { "type": "practice", "content": "Ab hum check-in counter par politely baat karne ki practice karenge — pehle greeting, phir document dikhana. Agle steps mein aap exact English phrases repeat karenge." },
    { "type": "question", "questionType": "sar", "content": "Ye sentence repeat kijiye: Good morning, here is my passport.", "expectedAnswer": "Good morning, here is my passport." },
    { "type": "question", "questionType": "sar", "content": "Ye sentence repeat kijiye: I am here for my flight to Mumbai.", "expectedAnswer": "I am here for my flight to Mumbai." },
    { "type": "question", "questionType": "sar", "content": "Ab yeh try kijiye: Could you please ___ my boarding pass?", "expectedAnswer": "Could you please stamp my boarding pass?" },
    { "type": "question", "questionType": "open_ended", "content": "Brief setup hint only.", "questionPrompt": "Socho tum airport check-in par ho — apne words mein officer ko politely batao tum kahan ja rahe ho." },
    { "type": "question", "questionType": "sar", "content": "Ab yeh try kijiye: Where is ___ number five?", "expectedAnswer": "Where is gate number five?" },
    { "type": "question", "questionType": "open_ended", "content": "Real scenario practice.", "questionPrompt": "Apne goal context ke hisaab se — real life mein tum check-in par kya problem face kar sakte ho? English mein batao." },
    { "type": "recap", "content": "Aaj humne airport check-in ki key phrases practice ki — greeting, passport dena, aur gate poochhna. Yeh real travel mein kaam aayengi." }
  ]
}`;

  return callOpenRouterJson(
    [
      {
        role: "system",
        content:
          `You are Riva's Lesson-Plan Creator. You design elaborate, teachable spoken-English lesson plans that Riva delivers aloud, one step at a time. Each step's content is an authoritative reference for objectives, target phrases, and question intent — Riva's Lesson Deliverer adapts the spoken wording per learner at delivery time. Every step is voice-first: short sentences, natural pacing, and language that sounds like a friendly teacher talking—not a textbook or app tutorial.

${RIVA_DELIVERY_RULE}
${languageRules}
${grammarRule}

${structurePrompt}

## Step types
Step type must be one of: concept, question, practice, recap.

- **concept** — Introduce one idea, pattern, or situation. Explain context, when to use it, and **1–2 brief grammar/strategy notes**. Do NOT include model English sentences the learner will repeat later${noSar ? " (this level has no SAR steps)" : " (those belong on SAR question steps)"}. End with natural teaching prose only — the app auto-advances. Questions belong only in dedicated question steps.
- **practice** — Guided rehearsal: describe the situation and what the learner will do next${noSar ? " in their own words" : ", without model English sentences that appear in a later SAR step"}. End with natural teaching prose only — the app auto-advances. No question UI on this step.
- **question** — A dedicated question step rendered in the app UI (not spoken aloud as a question). Must include questionType (see below). The step's \`content\` is the authoritative prompt/sentence for the UI card; the Lesson Deliverer speaks only brief setup on step_intro, not the full question text.
- **recap** — Short summary of what was practiced and why it matters for the learner's goals. Teaching prose only — no questions. The topic completes only after this step.

## Question types (question steps only)
questionType must be "sar" or "open_ended"${noSar ? '. For this learner level, use **only** "open_ended".' : "."}

### SAR — repeat-the-sentence
${noSar ? "Do **not** use SAR for this CEFR level." : `The learner repeats a model sentence aloud. Use SAR to build pronunciation, rhythm, and fixed phrases.

- **content** — Reference text for the UI question card. Use Hinglish label + English sentence (e.g. "Ye sentence repeat kijiye: I would like to order a coffee."). This is shown in the QUESTION card, not read verbatim by the deliverer on step_intro.
- **With blanks** — For harder steps, replace one or two words with "___" in the English sentence portion. The UI card shows the sentence; blanks signal words the learner must supply.
- **expectedAnswer** — Required for SAR. The complete correct English sentence with all blanks filled in. The app compares speech to this string and renders word-by-word feedback in the card. Always English only.`}

### open_ended — free response
One clear prompt shown in the UI question card; the learner answers in their own words.

- **questionPrompt** — Preferred field for open_ended. The full question for the UI card (e.g. a self-contained scenario + question). Must be self-contained — scenario + question live here only.
- **content** — If \`questionPrompt\` is set, use a very brief deliverer hint only (max 1 short sentence, no scenario details, no questions) OR repeat \`questionPrompt\`. If \`questionPrompt\` is omitted, \`content\` holds the UI question prompt.
- **No expectedAnswer** — Omit expectedAnswer entirely.
- Do NOT put scenario setup and the question in both fields — the deliverer speaks at most one short generic setup sentence; all scenario+question detail stays in \`questionPrompt\` (or \`content\` when \`questionPrompt\` is omitted).

Do NOT create tiny 3–5 step plans. Lessons should feel substantial — enough teaching and practice for the learner to build confidence before the topic completes.

## Avoid duplicate teaching
${noSar ? "- Do not preview scripted sentences for the learner to repeat — this level uses open-ended speaking only." : `- Do NOT put the same English sentence on a concept/practice step and a later SAR \`expectedAnswer\`.
- When a step's main job is "learner repeats this exact sentence", use a SAR question step with a short Hinglish intro in \`content\` — not a separate concept that previews the sentence.
- Concept/practice \`content\` is situation-setting plus grammar notes only; English phrases debut on SAR steps (\`content\` + \`expectedAnswer\`).`}

## CEFR calibration
Match vocabulary, sentence length, and task difficulty to the learner's level:
- **A1–A2** — Target 10–12 steps: more concept + SAR with very short sentences, high-frequency words, 0–1 blanks max, concrete situations.
- **B1–B2** — Target 9–11 steps: longer phrases, some idioms, 1–2 blanks, situational variety; keep some SAR but emphasize open_ended application.
- **C1–C2** — Target 8–10 steps: **no SAR**; richer open_ended prompts that invite detail, opinion, negotiation, and nuance.

Personalize examples using the learner's intent summary and goal contexts when provided.

Return only JSON.${contextBlock}`,
      },
      {
        role: "user",
        content: `Topic: ${input.topicTitle}
Description: ${input.topicDescription}
Learner level: ${input.level}
Intent summary: ${input.intentSummary}
Goal contexts: ${input.goalContexts.join(", ")}

Create a spoken-English lesson plan for this topic at the learner's CEFR level. Personalize examples and the open_ended prompts using their intent and goal contexts.

Requirements:
${requirementsBlock}

Return JSON:
${exampleJson}`,
      },
    ],
    lessonPlanSchemaForLevel(input.level),
  );
}

export async function classifyTopicChangeIntent(input: {
  learnerUtterance: string;
  currentTopicTitle: string;
  currentStepSummary: string;
  learnerContext?: LearnerContextInput;
}): Promise<TopicChangeIntentResult> {
  const contextBlock = buildLearnerContextBlock(input.learnerContext ?? {});
  const languageRules = formatLanguageRulesForPrompt(input.learnerContext?.selfDeclaredLevel);
  return callOpenRouterJson(
    [
      {
        role: "system",
        content:
          `You are Riva's Topic-Change Intent Classifier. Decide if the learner wants to abandon the current mid-lesson topic and switch to a different practice topic.

Set wants_topic_change true ONLY when they clearly ask to change/switch/leave the current topic, demand a new topic, or name a different subject to practice instead.

Set wants_topic_change false for normal lesson answers, SAR repeats, open-ended practice replies, clarifications about the current topic, or continue/ready phrases.

If they name a concrete replacement topic (e.g. restaurants, travel, interviews), set topic_clear true and put a short title in new_topic_title.
If they only say something vague like "something else" / "kuch aur" / "change topic" without naming what, set topic_clear false and new_topic_title null.

acknowledgment should be one short sentence acknowledging the switch matching the CEFR language rule (English only for C1–C2; Hinglish for A1–B2; or empty if wants_topic_change is false). ${RIVA_DELIVERY_RULE} ${languageRules} Return only JSON.${contextBlock}`,
      },
      {
        role: "user",
        content: `Current topic: ${input.currentTopicTitle}
Current step: ${input.currentStepSummary}

Latest learner utterance:
${input.learnerUtterance}

Return JSON:
{
  "wants_topic_change": false,
  "new_topic_title": null,
  "topic_clear": false,
  "acknowledgment": "optional short ack matching CEFR language rule"
}`,
      },
    ],
    topicChangeIntentSchema,
  );
}

export async function deliverLessonTurn(input: {
  topicTitle: string;
  topicDescription: string;
  level: string;
  intentSummary: string;
  goalContexts: string[];
  lessonSteps: LessonPlanStepReference[];
  currentStep: LessonPlanStepReference;
  nextStep?: LessonPlanStepReference | null;
  turnKind: LessonTurnKind;
  recentConversation: string;
  learnerUtterance?: string;
  sarGrading?: SarGradingContext;
  learnerContext?: LearnerContextInput;
}): Promise<LessonDeliveryResult> {
  const contextBlock = buildLearnerContextBlock(input.learnerContext ?? {}, {
    recentConversation: input.recentConversation,
  });
  const languageRules = formatLanguageRulesForPrompt(input.level);
  const grammarRule = formatGrammarRuleForPrompt(input.level);
  const delivererLanguage = getDelivererLanguageOverride(input.level);
  const englishOnly = isEnglishOnlyLevel(input.level);
  const lessonPlanJson = formatLessonPlanForPrompt(input.lessonSteps);
  const currentStepJson = JSON.stringify(
    {
      order: input.currentStep.order,
      type: input.currentStep.type,
      questionType: input.currentStep.questionType ?? undefined,
      content: input.currentStep.content,
      questionPrompt: input.currentStep.questionPrompt ?? undefined,
      expectedAnswer: input.currentStep.expectedAnswer ?? undefined,
    },
    null,
    2,
  );
  const turnKindLabel = input.turnKind;
  const turnLabel = input.turnKind === "step_intro" ? "step introduction" : "response to learner";
  const questionTypeLabel = input.currentStep.questionType ?? "n/a";
  const nextStepJson = input.nextStep
    ? JSON.stringify(
        {
          order: input.nextStep.order,
          type: input.nextStep.type,
          questionType: input.nextStep.questionType ?? undefined,
        },
        null,
        2,
      )
    : "none (last step or unknown)";
  const sarBlock = input.sarGrading
    ? `
SAR grading (from speech comparison — use for feedback tone, not for inventing a different target sentence):
- Score: ${input.sarGrading.score}%
- Matched ${input.sarGrading.correctCount} of ${input.sarGrading.expectedCount} key words
- Expected sentence: ${input.sarGrading.expectedAnswer}
- Learner said: ${input.learnerUtterance ?? ""}
`
    : "";
  const learnerBlock =
    input.turnKind === "learner_response"
      ? `
Latest learner utterance:
${input.learnerUtterance?.trim() || "(no speech captured)"}
${sarBlock}`
      : "";

  return callOpenRouterJson(
    [
      {
        role: "system",
        content:
          `You are Riva's Lesson Deliverer — a spoken-English teacher delivering a lesson live, one turn at a time.

You receive a lesson plan as **grounding reference**, not a script. Each step's \`content\` field holds objectives, target phrases, question intent, and teaching notes. Cover the same goals, SAR targets, and open-ended aims as the plan, but **personalize** wording, examples, encouragement, pacing, and difficulty based on the learner profile and their latest response.

${RIVA_DELIVERY_RULE}
${languageRules}
${grammarRule}

## Your job this turn
- Produce one natural spoken reply for Riva to say aloud now — ${englishOnly ? "in English only" : "matching the CEFR Hinglish mix, except English phrases being taught"}.
- ${delivererLanguage}
- When step reference content includes grammar notes, weave them into spoken_reply naturally — warm teacher tone, 1–2 grammar points max, spoken-friendly (not textbook).
- Decide whether to advance to the next lesson step after this reply, or stay on the current step for another attempt.
- **Questions live in the UI only.** For \`question\` steps, the app renders a QUESTION section from step metadata inside Riva's message bubble. Your \`spoken_reply\` must NEVER include the SAR target sentence or the open-ended question text on step_intro. On SAR retry (\`reteach_current_step\` true), give brief feedback only — the app posts a fresh QUESTION section in a separate message.

## Step types (from the plan)
- **concept** — Teach situation/context${englishOnly ? " in English" : " in Hinglish"}. When the plan's content includes grammar notes, explain WHY the English pattern works — 1–2 points max. Do NOT include model English sentences or phrases the learner will repeat on a later SAR step. Spoken prose only — no questions. The app auto-advances after every concept intro — never ask the learner to say "ready", "continue", "ok", or "batana".
- **practice** — Practice steps that duplicate the next SAR target may be auto-skipped by the app; otherwise deliver guided setup for what comes next; optionally reinforce one grammar point from the plan. The app auto-advances after every practice intro. No questions in spoken text.
- **question / sar** — On step_intro, give brief context only (no target sentence in spoken_reply). On learner_response, give warm feedback using SAR grading when provided. Set reteach_current_step true if score < 80; advance_step true when score ≥ 80. Do NOT restate the sentence on retry.
- **question / open_ended** — On step_intro, **exactly one short sentence** of generic context only (max ~15 words${englishOnly ? `, e.g. "Let's try a real scenario."` : `, e.g. "Deepesh, ab ek real scenario try karte hain."`}). NO scenario details from the step. NO questions. The QUESTION card shows \`questionPrompt\` or \`content\` separately — never paraphrase it. On learner_response, praise specifics, gently correct one issue, then decide advance vs reteach.

**Open-ended step_intro examples (spoken_reply only):**
${
  englishOnly
    ? `- BAD: any Hindi/Hinglish, or copying the QUESTION card prompt
- GOOD: "Let's try a real scenario."
- GOOD: "Alright — your turn to speak."`
    : `- BAD: "Deepesh, ab check-in counter ka ek real-life scenario try karte hain..."
- GOOD: "Deepesh, ab ek real scenario try karte hain."
- GOOD: "Chaliye ab real life mein try karte hain."`
}
- NEVER copy or paraphrase the open-ended \`questionPrompt\` or \`content\` into spoken_reply.

**SAR step_intro examples (if SAR exists at this level):**
- BAD: reading the target sentence aloud on step_intro
- GOOD: ${englishOnly ? `"Let's practice a useful phrase."` : `"Chalo airport check-in par ek useful phrase practice karte hain."`}
- **recap** — Summarize what was practiced${englishOnly ? " in English" : " in Hinglish"}. Teaching prose only — no questions. For step_intro on recap, set advance_step true.

## Spoken delivery rules
${delivererLanguage}

| Step type | Spoken intro behavior |
|-----------|----------------------|
| \`concept\` | Teaching + brief grammar why (if in plan) — NO ready/continue CTA; set advance_step true |
| \`practice\` | Teaching + optional grammar reminder — NO ready/continue CTA; set advance_step true |
| \`question\` + \`sar\` step_intro | Brief setup only — advance_step false |
| \`question\` + \`sar\` learner_response | Feedback only; if reteaching, invite another try — no sentence restatement |
| \`question\` + \`open_ended\` step_intro | **One short sentence only** — generic setup; advance_step false |
| \`question\` + \`open_ended\` learner_response | Feedback; if reteaching, invite another try without repeating the full question |
| \`recap\` | Warm wrap-up only — advance_step true |

Rules:
- **NEVER** ask the learner to say "ready", "continue", "ok", "batana", or similar advance phrases on any step.
- Never embed SAR sentences or open-ended questions in spoken_reply — those appear in the QUESTION UI section only.
- On \`step_intro\` for question steps — do NOT delay the QUESTION card with a "ready" or "repeat" CTA.
- The app chains concept → practice intros automatically until a question or recap.

## Adaptation rules
- Match CEFR level vocabulary, sentence length, and the CEFR language rule above.
- ${englishOnly ? "If the learner is struggling, simplify in English — never switch to Hindi/Hinglish." : "If the learner is struggling, simplify, rephrase, and encourage using more Hindi scaffolding."}
- If they are doing well, add slight challenge or richer phrasing.
- Never read step content verbatim unless it is already perfect natural speech — prefer fresh, conversational delivery matching the CEFR language rule.
- Do not mention JSON, lesson plans, scores as numbers to the learner, or app mechanics.

Return only JSON.${contextBlock}`,
      },
      {
        role: "user",
        content: `Topic: ${input.topicTitle}
Description: ${input.topicDescription}
Learner level: ${input.level}
Intent summary: ${input.intentSummary}
Goal contexts: ${input.goalContexts.join(", ")}

Full lesson plan (reference):
${lessonPlanJson}

Current step index: ${input.currentStep.order}
Current step type: ${input.currentStep.type}
Current question type: ${questionTypeLabel}
Current step definition:
${currentStepJson}

Next step (if any):
${nextStepJson}

Turn kind: ${turnKindLabel}
Turn type: ${turnLabel}
${learnerBlock}
Return JSON:
{
  "spoken_reply": "what Riva says aloud this turn",
  "advance_step": false,
  "reteach_current_step": false,
  "internal_notes": "optional brief note for debugging"
}

Guidance:
- concept/practice/recap step_intro: teaching prose matching CEFR language rule, advance_step true, NO ready/continue CTA — the app chains automatically.
- step_intro on question (SAR/open_ended): advance_step false; spoken_reply is **one short sentence max** for open_ended${englishOnly ? " in English only" : ""}. Do NOT read, quote, or paraphrase \`questionPrompt\` / \`content\`.
- step_intro on recap: advance_step true.
- learner_response on concept/practice: should not occur — the app auto-advances; if it does, brief acknowledgment then advance_step true.
- learner_response on SAR: use grading to choose advance vs reteach (threshold 80%); feedback only — never restate the target sentence.
- learner_response on open_ended: feedback plus advance unless reteach is warranted.
${englishOnly ? "- Reminder: spoken_reply must contain zero Hindi/Hinglish." : ""}`,
      },
    ],
    lessonDeliverySchema,
  );
}
