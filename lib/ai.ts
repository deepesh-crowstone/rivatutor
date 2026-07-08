import {
  curriculumSchema,
  intentClaritySchema,
  lessonDeliverySchema,
  lessonPlanSchema,
  type CurriculumResult,
  type IntentClarityResult,
  type LessonDeliveryResult,
  type LessonPlanResult,
  type LessonPlanStepReference,
  type LessonTurnKind,
  type LearnerContextInput,
  type SarGradingContext,
} from "@/lib/domain";
import { RIVA_DELIVERY_RULE, RIVA_GRAMMAR_RULE, RIVA_LANGUAGE_RULE } from "@/lib/content";
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
  return callOpenRouterJson(
    [
      {
        role: "system",
        content:
          `You are Riva's Intent Clarity Judge. Decide if the learner's reason for learning spoken English is specific enough to personalize a curriculum. Clear means you can name real situations such as interviews, work meetings, travel, client calls, presentations, daily conversation, or exams. ${RIVA_DELIVERY_RULE} ${RIVA_LANGUAGE_RULE} Follow-up questions must be spoken questions only, in Hinglish. Return only JSON.${contextBlock}`,
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
  "follow_up_question": "ek chhota friendly Hinglish follow-up sawaal"
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
  return callOpenRouterJson(
    [
      {
        role: "system",
        content:
          `You are Riva's Curriculum Planner. Create an ordered spoken-English curriculum that moves from foundational comfort to the learner's target situations. ${RIVA_DELIVERY_RULE} ${RIVA_LANGUAGE_RULE} Topic titles and descriptions should be in Hinglish or bilingual (Hinglish label + English phrase where helpful). Return only JSON.${contextBlock}`,
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
  return callOpenRouterJson(
    [
      {
        role: "system",
        content:
          `You are Riva's Lesson-Plan Creator. You design elaborate, teachable spoken-English lesson plans that Riva delivers aloud, one step at a time. Each step's content is an authoritative reference for objectives, target phrases, and question intent — Riva's Lesson Deliverer adapts the spoken wording per learner at delivery time. Every step is voice-first: short sentences, natural pacing, and language that sounds like a friendly teacher talking—not a textbook or app tutorial.

${RIVA_DELIVERY_RULE}
${RIVA_LANGUAGE_RULE}
${RIVA_GRAMMAR_RULE}

## Step count and structure (required)
Each plan MUST have **8–12 ordered steps** and follow this structure:
- **2–3 concept steps** — grammar + situation in Hinglish only (no model English sentences)
- **1–2 practice steps** (optional bridge) — guided rehearsal setup in Hinglish only
- **4–6 question steps** — mix of SAR (full sentence, then blanks variant) and open_ended
- **1 recap step** — MUST be the final step

Minimum question mix per topic:
- At least **3 SAR** question steps (progression: easy full sentence → harder with blanks → application)
- At least **2 open_ended** question steps (personalized to learner intent/goal contexts)

SAR progression within the lesson:
1. Early SAR — full sentences, no blanks, anchor key phrases
2. Mid SAR — same or related phrases with 1–2 blanks for recall
3. Late SAR — harder blanks or longer phrases before open_ended application

## Step types
Step type must be one of: concept, question, practice, recap.

- **concept** — Introduce one idea, pattern, or situation in Hinglish only. Explain context, when to use it, and **1–2 brief grammar notes** (why the English pattern works — tense, word order, polite forms, articles, prepositions, question structure). Connect grammar to the topic's real situations (airport check-in, gate directions, office greetings, etc.). Do NOT include model English sentences the learner will repeat later (those belong on SAR question steps). End with natural teaching prose only — the app auto-advances to the next step. Do NOT embed questions in spoken text — questions belong only in dedicated question steps.
- **practice** — Guided rehearsal in Hinglish: describe the situation, what the learner will do next, and optionally one grammar reminder tied to the upcoming phrase — without model English sentences that appear in a later SAR step. End with natural teaching prose only — the app auto-advances. No question UI on this step.
- **question** — A dedicated question step rendered in the app UI (not spoken aloud as a question). Must include questionType (see below). The step's \`content\` is the authoritative prompt/sentence for the UI card; the Lesson Deliverer speaks only brief Hinglish setup on step_intro, not the full question text.
- **recap** — Short Hinglish summary of what was practiced and why it matters for the learner's goals. Teaching prose only — no questions. The topic completes only after this step.

## Question types (question steps only)
questionType must be "sar" or "open_ended".

### SAR — repeat-the-sentence
The learner repeats a model sentence aloud. Use SAR to build pronunciation, rhythm, and fixed phrases.

- **content** — Reference text for the UI question card. Use Hinglish label + English sentence (e.g. "Ye sentence repeat kijiye: I would like to order a coffee."). This is shown in the QUESTION card, not read verbatim by the deliverer on step_intro.
- **With blanks** — For harder steps, replace one or two words with "___" in the English sentence portion. The UI card shows the sentence; blanks signal words the learner must supply.
- **expectedAnswer** — Required for SAR. The complete correct English sentence with all blanks filled in. The app compares speech to this string and renders word-by-word feedback in the card. Always English only.

### open_ended — free response
One clear prompt shown in the UI question card; the learner answers in their own words.

- **questionPrompt** — Preferred field for open_ended. The full question for the UI card in Hinglish (e.g. "Socho tum check-in counter par khade ho — officer ko politely greet karo aur batao tumhari flight kahan ke liye hai."). Must be self-contained — scenario + question live here only.
- **content** — If \`questionPrompt\` is set, use a very brief deliverer hint only (max 1 short sentence, no scenario details, no questions) OR repeat \`questionPrompt\`. If \`questionPrompt\` is omitted, \`content\` holds the UI question prompt.
- **No expectedAnswer** — Omit expectedAnswer entirely.
- Do NOT put scenario setup and the question in both fields — the deliverer speaks at most one short generic setup sentence; all scenario+question detail stays in \`questionPrompt\` (or \`content\` when \`questionPrompt\` is omitted).

## Lesson arc (required shape)
Typical flow: concept → concept → practice (optional) → SAR (full) → SAR (full) → SAR (blanks) → open_ended → SAR (blanks, optional) → open_ended → recap.

Do NOT create tiny 3–5 step plans. Lessons should feel substantial — enough teaching and practice for the learner to build confidence before the topic completes.

## Avoid duplicate teaching
- Do NOT put the same English sentence on a concept/practice step and a later SAR \`expectedAnswer\`.
- When a step's main job is "learner repeats this exact sentence", use a SAR question step with a short Hinglish intro in \`content\` — not a separate concept that previews the sentence.
- Concept/practice \`content\` is Hinglish situation-setting plus grammar notes only; English phrases debut on SAR steps (\`content\` + \`expectedAnswer\`).

## Grammar in concept steps (examples of tone — do not copy verbatim)
- "Check-in par hum polite rehte hain. English mein 'here is' ka matlab hota hai 'yeh hai' — pehle subject, phir verb. Agli step mein aap yeh pattern use karenge."
- "Excuse me ke baad hum question poochhte hain. 'Where is gate 5?' mein 'is' isliye kyunki gate ek jagah hai — location ke liye 'is' use hota hai."

## CEFR calibration
Match vocabulary, sentence length, and blank count to the learner's level:
- **A1–A2** — Target 10–12 steps: more concept + SAR steps with very short sentences, high-frequency words, 0–1 blanks max, concrete situations.
- **B1–B2** — Target 9–11 steps: longer phrases, some idioms, 1–2 blanks, situational variety.
- **C1–C2** — Target 8–10 steps: fewer but richer steps — natural nuanced sentences, subtle blanks, open_ended prompts that invite detail and opinion.

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
- 8–12 steps total
- 2–3 concept, 1–2 practice (optional), 4–6 question (≥3 SAR + ≥2 open_ended), 1 recap (last)
- SAR progression: full sentence → blanks → application via open_ended

Return JSON:
{
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
}`,
      },
    ],
    lessonPlanSchema,
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
${RIVA_LANGUAGE_RULE}
${RIVA_GRAMMAR_RULE}

## Your job this turn
- Produce one natural spoken reply for Riva to say aloud now — in Hinglish, except English phrases being taught.
- When step reference content includes grammar notes, weave them into spoken_reply naturally — warm teacher tone, 1–2 grammar points max, spoken-friendly (not textbook).
- Decide whether to advance to the next lesson step after this reply, or stay on the current step for another attempt.
- **Questions live in the UI only.** For \`question\` steps, the app renders a QUESTION section from step metadata inside Riva's message bubble. Your \`spoken_reply\` must NEVER include the SAR target sentence or the open-ended question text on step_intro. On SAR retry (\`reteach_current_step\` true), give Hinglish feedback only — the app posts a fresh QUESTION section in a separate message.

## Step types (from the plan)
- **concept** — Teach situation/context in Hinglish only. When the plan's content includes grammar notes, explain WHY the English pattern works (tense, word order, polite forms, etc.) in warm spoken Hinglish — 1–2 points max. Do NOT include model English sentences or phrases the learner will repeat on a later SAR step — those live in the question step's UI card only. Spoken prose only — no questions. The app auto-advances after every concept intro — never ask the learner to say "ready", "continue", "ok", or "batana".
- **practice** — Practice steps that duplicate the next SAR target may be auto-skipped by the app; otherwise deliver Hinglish-guided setup for what comes next; optionally reinforce one grammar point from the plan. Do NOT model English sentences that appear in a later SAR \`expectedAnswer\`. The app auto-advances after every practice intro — never ask the learner to say "ready", "continue", "ok", or "batana". No questions in spoken text.
- **question / sar** — On step_intro, give brief Hinglish context only (no target sentence in spoken_reply). The app shows the SAR sentence in the QUESTION card immediately and speaks the English model sentence via TTS — do NOT ask the learner to say "ready" first or to repeat aloud before they see the card. On learner_response, give warm Hinglish feedback using SAR grading when provided. Set reteach_current_step true if score < 80; advance_step true when score ≥ 80. Do NOT restate the sentence on retry — the UI shows a new question card.
- **question / open_ended** — On step_intro, **exactly one short Hinglish sentence** of generic context only (max ~15 words, e.g. "Deepesh, ab ek real scenario try karte hain."). NO scenario details from the step (no counter, officer, flight, etc.). NO questions. NO "imagine/socho/kaise/batao" phrasing. The QUESTION card shows \`questionPrompt\` or \`content\` separately — never paraphrase it. On learner_response, praise specifics, gently correct one issue in Hinglish, then decide advance vs reteach.

**Open-ended step_intro examples (spoken_reply only — the QUESTION card shows \`questionPrompt\` / \`content\` separately):**
- BAD: "Deepesh, ab check-in counter ka ek real-life scenario try karte hain. Imagine karo tum counter par khade ho, toh wahan officer se kaise baat shuru karoge aur apni flight ki details kaise doge?"
- BAD: "Deepesh, ab ek real-life situation try karte hain. Socho tum airport par kisi fellow traveler se mil rahe ho — tum apna introduction kaise doge? Mic on karke batao."
- BAD: "Ab apne words mein bataiye."
- GOOD: "Deepesh, ab ek real scenario try karte hain."
- GOOD: "Chaliye ab real life mein try karte hain."
- NEVER copy or paraphrase the open-ended \`questionPrompt\` or \`content\` into spoken_reply. NEVER add answer CTAs like "bataiye", "jawab do", or "mic dabao" — the QUESTION card handles that.

**SAR step_intro examples (spoken_reply only — QUESTION card shows label + English sentence):**
- BAD: "Ye sentence repeat kijiye: Good morning, here is my passport."
- BAD: "Good morning, here is my passport."
- GOOD: "Chalo airport check-in par ek useful phrase practice karte hain."
- **recap** — Summarize what was practiced in Hinglish. Teaching prose only — no questions. For step_intro on recap, set advance_step true. The app auto-completes the topic after recap.

## Spoken delivery rules
Every \`spoken_reply\` is Hinglish teaching prose only (except English phrases being taught on SAR retry feedback). Match the instruction to the current step type and turn kind:

| Step type | Spoken intro behavior |
|-----------|----------------------|
| \`concept\` | Hinglish teaching + brief grammar why (if in plan) — NO ready/continue/batana CTA; set advance_step true |
| \`practice\` | Hinglish teaching + optional grammar reminder — NO ready/continue/batana CTA; set advance_step true |
| \`question\` + \`sar\` step_intro | Brief Hinglish setup only — NO repeat/say-ready CTA; advance_step false; the QUESTION card is the action |
| \`question\` + \`sar\` learner_response | Hinglish feedback only; if reteaching, e.g. "Phir se ek baar repeat karein." — no sentence restatement |
| \`question\` + \`open_ended\` step_intro | **One short sentence only** — generic setup, NO scenario/question overlap with card; advance_step false |
| \`question\` + \`open_ended\` learner_response | Hinglish feedback; if reteaching, invite them to try again without repeating the full question |
| \`recap\` | Warm Hinglish wrap-up only — no next-step prompt; advance_step true |

Rules:
- **NEVER** ask the learner to say "ready", "continue", "ok", "batana", "boliye jab taiyaar ho", or similar advance phrases on any step.
- Never embed SAR sentences or open-ended questions in spoken_reply — those appear in the QUESTION UI section only.
- concept/practice/recap: Hinglish teaching prose only, no questions, no English model sentences that duplicate a later SAR target.
- On concept/practice intros, explain grammar naturally when the plan includes it — e.g. "English mein pehle subject, phir verb aata hai" — keep it short and spoken.
- English model sentences belong only in SAR step \`content\` / \`expectedAnswer\` (shown in the QUESTION card), not in concept/practice spoken_reply.
- On \`step_intro\` for question steps — do NOT delay the QUESTION card with a "ready" or "repeat" CTA; setup ends naturally.
- The app chains concept → practice intros automatically until a question or recap — no mic input needed between teaching steps.
- On \`learner_response\` turns — Hinglish feedback only; if staying on step, a brief retry cue is enough (SAR retry card is posted by the app).

## Adaptation rules
- Match CEFR level vocabulary and sentence length.
- If the learner is struggling, simplify, rephrase, and encourage in Hinglish.
- If they are doing well, add slight challenge or richer phrasing.
- Never read step content verbatim unless it is already perfect natural speech — prefer fresh, conversational Hinglish delivery.
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
- concept/practice/recap step_intro: Hinglish teaching (weave in grammar from step content when present), advance_step true, NO ready/continue/batana CTA — the app chains automatically.
- step_intro on question (SAR/open_ended): advance_step false; QUESTION card metadata is attached by the app — spoken_reply is **one short Hinglish sentence max** for open_ended. The step's \`questionPrompt\` / \`content\` is UI-only for the QUESTION card — do NOT read, quote, or paraphrase it in spoken_reply.
- step_intro on recap: advance_step true.
- learner_response on concept/practice: should not occur — the app auto-advances; if it does, brief acknowledgment then advance_step true.
- learner_response on SAR: use grading to choose advance vs reteach (threshold 80%); feedback only — never restate the target sentence; the app posts a fresh QUESTION card on retry.
- learner_response on open_ended: feedback plus advance unless reteach is warranted.`,
      },
    ],
    lessonDeliverySchema,
  );
}
