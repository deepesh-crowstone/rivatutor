"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { AppState, ChatMessageDto, LessonStepDto, QuestionCardMetadata } from "@/lib/domain";
import { CEFR_LEVELS } from "@/lib/domain";
import { loadingLabel, topicSuggestionsUiLabel } from "@/lib/cefr-copy";
import { SAR_QUESTION_PROMPT, stripUiInstructions } from "@/lib/content";
import { buildAssistantSpeechSegments } from "@/lib/assistant-speech";
import { sanitizeQuestionStepIntroReply } from "@/lib/lesson-delivery";
import { deriveComposerState, type ComposerMode, type RecordingTarget } from "@/lib/composer-mode";
import { isStreamingPcmResponse, PcmChunkPlayer } from "@/lib/pcm-player";
import {
  getPendingAssistantMessagesForTts,
  markAssistantMessageSkipped,
} from "@/lib/tts-playback-queue";
import { TtsSessionTracker } from "@/lib/tts-session";
import { parseUsernameInput } from "@/lib/username-rules";
type ComposerPhase = "idle" | "transcribing" | "waitingForRiva";

const PENDING_USER_MESSAGE_ID = "pending-user-message";

function parseQuestionMetadata(metadata: unknown): QuestionCardMetadata | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  return metadata as QuestionCardMetadata;
}

function isSarLessonStep(step: LessonStepDto | null | undefined): boolean {
  return step?.type === "question" && step.questionType === "sar";
}

export function RivaApp() {
  const [state, setState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(loadingLabel("session"));
  const [error, setError] = useState("");
  const [composerPhase, setComposerPhase] = useState<ComposerPhase>("idle");
  const [pendingUserMessage, setPendingUserMessage] = useState<ChatMessageDto | null>(null);
  const [recordingTarget, setRecordingTarget] = useState<RecordingTarget | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const discardRecordingRef = useRef(false);
  const lastSpokenIdRef = useRef<string | null>(null);
  const currentlySpeakingMessageIdRef = useRef<string | null>(null);
  const pcmPlayerRef = useRef<PcmChunkPlayer | null>(null);
  const ttsSessionRef = useRef(new TtsSessionTracker());
  const ttsAbortControllerRef = useRef<AbortController | null>(null);
  const blobAudioRef = useRef<HTMLAudioElement | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);

  const pendingTopics = useMemo(
    () => (state?.topics ?? []).filter((topic) => topic.status === "pending").slice(0, 3),
    [state?.topics],
  );

  const { needsUsername, needsName, needsLevel, hasCurriculum, hasActiveTopic, composerMode, micDisabled } =
    deriveComposerState(state);
  const composerBusy = composerPhase !== "idle";
  const learnerLevel = state?.profile.selfDeclaredLevel;

  async function refreshState() {
    await run(loadingLabel("session", learnerLevel), async () => {
      setState(await api<AppState>("/api/session"));
    });
  }

  async function submitUsernameAnswer(rawUsername: string) {
    abortTtsPlayback();
    const username = parseUsernameInput(rawUsername);
    setState(await api("/api/session/username", { method: "POST", body: { username } }));
    return true;
  }

  async function submitOnboardingAnswer(answer: string) {
    if (!answer.trim()) {
      setError(needsName ? "Riva ko apna naam batayein." : "Level chuno jaise A1, A2, B1, B2, C1, ya C2.");
      return false;
    }

    setState(await api("/api/onboarding", { method: "POST", body: { answer } }));
    return true;
  }

  async function selectLevel(level: string) {
    abortTtsPlayback();
    await run(loadingLabel("level", level), async () => {
      setState(await api("/api/onboarding", { method: "POST", body: { answer: level } }));
    });
  }

  async function submitIntentAnswer(answer: string) {
    if (!answer.trim()) {
      setError("Riva ko batayein aap English kyun seekhna chahte hain.");
      return false;
    }

    setState(await api("/api/intent", { method: "POST", body: { answer } }));
    return true;
  }

  async function selectTopic(topicId: string) {
    abortTtsPlayback();
    await run(loadingLabel("lessonPlan", learnerLevel), async () => {
      setState(await api("/api/topics/select", { method: "POST", body: { topicId } }));
    });
  }

  async function selectFreeformTopicAnswer(topic: string) {
    if (!topic.trim()) {
      setError("Riva ko batayein kya topic sikhana hai.");
      return false;
    }

    setState(
      await api("/api/topics/select", {
        method: "POST",
        body: { freeformTitle: topic },
      }),
    );
    return true;
  }

  async function submitLessonAnswer(answer: string) {
    setState(await api("/api/lesson/answer", { method: "POST", body: { answer } }));
    return true;
  }

  async function submitTranscriptFromMic(text: string, mode: RecordingTarget) {
    const trimmed = text.trim();

    if (mode === "onboarding") {
      return submitOnboardingAnswer(trimmed);
    }

    if (mode === "intent") {
      return submitIntentAnswer(trimmed);
    }

    if (mode === "topic") {
      return selectFreeformTopicAnswer(trimmed);
    }

    if (mode === "lesson") {
      return submitLessonAnswer(trimmed);
    }

    return false;
  }

  async function reset() {
    abortTtsPlayback();
    await run(loadingLabel("session", learnerLevel), async () => {
      const nextState = await api<AppState>("/api/session", { method: "DELETE" });
      setState(nextState);
      lastSpokenIdRef.current = null;
      currentlySpeakingMessageIdRef.current = null;
    });
  }

  function abortTtsPlayback() {
    const messages = state?.messages ?? [];
    lastSpokenIdRef.current = markAssistantMessageSkipped(
      messages,
      currentlySpeakingMessageIdRef.current,
      lastSpokenIdRef.current,
    );
    currentlySpeakingMessageIdRef.current = null;
    ttsSessionRef.current.abort();
    ttsAbortControllerRef.current?.abort();
    ttsAbortControllerRef.current = null;
    pcmPlayerRef.current?.stop();
    window.speechSynthesis?.cancel();
    stopBlobAudio();
  }

  function stopBlobAudio() {
    if (!blobAudioRef.current) {
      return;
    }

    blobAudioRef.current.pause();
    blobAudioRef.current.removeAttribute("src");
    blobAudioRef.current.load();
    blobAudioRef.current = null;
  }

  async function run(label: string, action: () => Promise<void>) {
    setError("");
    setLoading(label);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Kuch galat ho gaya.");
    } finally {
      setLoading("");
    }
  }

  async function startRecording(target: RecordingTarget) {
    try {
      abortTtsPlayback();
      setError("");
      discardRecordingRef.current = false;
      if (!pcmPlayerRef.current) {
        pcmPlayerRef.current = new PcmChunkPlayer();
      }
      await pcmPlayerRef.current.prepareForPlayback();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorderRef.current = recorder;
      setRecordingTarget(target);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;

        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          chunksRef.current = [];
          return;
        }

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        void transcribeAndSubmit(blob, target);
      };

      recorder.start();
    } catch {
      setError("Microphone access block ya unavailable hai.");
      setRecordingTarget(null);
    }
  }

  function stopRecording() {
    discardRecordingRef.current = false;
    recorderRef.current?.stop();
    setRecordingTarget(null);
  }

  function discardRecording() {
    if (!recorderRef.current) {
      return;
    }

    discardRecordingRef.current = true;
    chunksRef.current = [];
    recorderRef.current.stop();
    setRecordingTarget(null);
  }

  async function transcribeAndSubmit(blob: Blob, target: RecordingTarget) {
    setError("");
    setComposerPhase("transcribing");

    try {
      const formData = new FormData();
      formData.append("audio", blob, "riva-answer.webm");
      const response = await fetch("/api/stt", { method: "POST", body: formData });
      const payload = (await response.json()) as { text?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not transcribe audio.");
      }

      const text = payload.text ?? "";
      const trimmed = text.trim();
      const hidePendingUserMessage =
        target === "lesson" && isSarLessonStep(state?.currentStep ?? null);
      if (trimmed && !hidePendingUserMessage) {
        setPendingUserMessage({
          id: PENDING_USER_MESSAGE_ID,
          role: "user",
          kind: "message",
          content: trimmed,
          metadata: null,
          createdAt: new Date().toISOString(),
        });
      }

      setComposerPhase("waitingForRiva");
      const submitted = await submitTranscriptFromMic(text, target);
      if (!submitted) {
        setPendingUserMessage(null);
        return;
      }

      setPendingUserMessage(null);
    } catch (caught) {
      setPendingUserMessage(null);
      setError(caught instanceof Error ? caught.message : "Kuch galat ho gaya.");
    } finally {
      setComposerPhase("idle");
    }
  }

  async function speakAssistantMessage(message: ChatMessageDto): Promise<boolean> {
    const sessionId = ttsSessionRef.current.currentSessionId();
    const segments = buildAssistantSpeechSegments(message);

    for (const segment of segments) {
      if (!ttsSessionRef.current.isSessionActive(sessionId)) {
        return false;
      }

      const played = await playTts(segment, sessionId);
      if (!played) {
        return false;
      }
    }

    return ttsSessionRef.current.isSessionActive(sessionId);
  }

  async function playTts(text: string, sessionId: number): Promise<boolean> {
    if (!ttsSessionRef.current.isSessionActive(sessionId)) {
      return false;
    }

    const spokenText = cleanSpokenText(text);
    if (!spokenText) {
      return true;
    }

    const { segmentId } = ttsSessionRef.current.beginSegment();
    pcmPlayerRef.current?.stop();
    window.speechSynthesis?.cancel();
    stopBlobAudio();

    if (state?.missingApiKey) {
      return speakWithBrowserVoice(spokenText, sessionId, segmentId);
    }

    const controller = new AbortController();
    ttsAbortControllerRef.current = controller;

    try {
      const response = await fetchTts(spokenText, "stream", controller.signal);
      if (!ttsSessionRef.current.isPlaybackActive(sessionId, segmentId)) {
        return false;
      }
      if (!response.ok) {
        const errorMessage = await readTtsError(response);
        console.warn("[riva-tts] API failed:", errorMessage);
        return playTtsFallback(spokenText, sessionId, segmentId, errorMessage);
      }

      if (isStreamingPcmResponse(response)) {
        if (!pcmPlayerRef.current) {
          pcmPlayerRef.current = new PcmChunkPlayer();
        }

        const played = await pcmPlayerRef.current.playResponse(response);
        if (!ttsSessionRef.current.isPlaybackActive(sessionId, segmentId)) {
          return false;
        }
        if (played) {
          return true;
        }

        console.warn("[riva-tts] PCM stream did not play; retrying with MP3.");
        const mp3Response = await fetchTts(spokenText, "mp3", controller.signal);
        if (!ttsSessionRef.current.isPlaybackActive(sessionId, segmentId)) {
          return false;
        }
        if (mp3Response.ok) {
          const mp3Played = await playBlobAudio(mp3Response, sessionId, segmentId);
          if (mp3Played) {
            return true;
          }
        } else {
          const mp3Error = await readTtsError(mp3Response);
          console.warn("[riva-tts] MP3 fallback failed:", mp3Error);
        }

        return playTtsFallback(spokenText, sessionId, segmentId);
      }

      const played = await playBlobAudio(response, sessionId, segmentId);
      return played || playTtsFallback(spokenText, sessionId, segmentId);
    } catch (error) {
      if (isTtsAbortError(error)) {
        return false;
      }
      if (!ttsSessionRef.current.isSessionActive(sessionId)) {
        return false;
      }
      console.warn("[riva-tts] Playback error:", error);
      return playTtsFallback(spokenText, sessionId, segmentId);
    } finally {
      if (ttsAbortControllerRef.current === controller) {
        ttsAbortControllerRef.current = null;
      }
    }
  }

  async function playTtsFallback(
    spokenText: string,
    sessionId: number,
    segmentId: number,
    apiError?: string,
  ): Promise<boolean> {
    if (!ttsSessionRef.current.isPlaybackActive(sessionId, segmentId)) {
      return false;
    }

    const usedBrowserVoice = speakWithBrowserVoice(spokenText, sessionId, segmentId);
    if (usedBrowserVoice) {
      if (apiError) {
        console.warn("[riva-tts] Using browser voice fallback after API error.");
      }
      return true;
    }

    if (apiError?.includes("Insufficient credits")) {
      setError("Riva ki awaaz abhi band hai — OpenRouter credits khatam ho gaye hain.");
    }

    return false;
  }

  async function fetchTts(text: string, format: "stream" | "mp3" | "wav", signal?: AbortSignal) {
    return fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, format }),
      signal,
    });
  }

  async function readTtsError(response: Response) {
    try {
      const payload = (await response.clone().json()) as { error?: string };
      return payload.error ?? `TTS request failed (${response.status})`;
    } catch {
      return `TTS request failed (${response.status})`;
    }
  }

  async function playBlobAudio(response: Response, sessionId: number, segmentId: number) {
    const blob = await response.blob();
    if (!ttsSessionRef.current.isPlaybackActive(sessionId, segmentId)) {
      return false;
    }

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    blobAudioRef.current = audio;

    try {
      await audio.play();
      if (!ttsSessionRef.current.isPlaybackActive(sessionId, segmentId)) {
        audio.pause();
        URL.revokeObjectURL(url);
        return false;
      }

      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (blobAudioRef.current === audio) {
            blobAudioRef.current = null;
          }
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          if (blobAudioRef.current === audio) {
            blobAudioRef.current = null;
          }
          reject(new Error("Audio element playback failed."));
        };
      });
      return ttsSessionRef.current.isPlaybackActive(sessionId, segmentId);
    } catch (error) {
      URL.revokeObjectURL(url);
      if (blobAudioRef.current === audio) {
        blobAudioRef.current = null;
      }
      console.warn("[riva-tts] Blob playback failed:", error);
      return false;
    }
  }

  function speakWithBrowserVoice(text: string, sessionId: number, segmentId: number) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return false;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.onend = () => {
      if (!ttsSessionRef.current.isPlaybackActive(sessionId, segmentId)) {
        window.speechSynthesis.cancel();
      }
    };
    window.speechSynthesis.speak(utterance);
    return true;
  }

  const displayMessages = useMemo(() => {
    const serverMessages = state?.messages ?? [];
    if (!pendingUserMessage) {
      return serverMessages;
    }

    const serverAlreadyHasPending = serverMessages.some(
      (message) => message.role === "user" && message.content === pendingUserMessage.content,
    );
    if (serverAlreadyHasPending) {
      return serverMessages;
    }

    return [...serverMessages, pendingUserMessage];
  }, [pendingUserMessage, state?.messages]);

  const chatScrollKey = useMemo(() => {
    const messageKey = displayMessages
      .map((message) => `${message.id}:${message.content.length}:${message.kind}`)
      .join("|");
    return [messageKey, composerPhase, loading, needsLevel, pendingTopics.length].join("::");
  }, [composerPhase, displayMessages, loading, needsLevel, pendingTopics.length]);

  useEffect(() => {
    const scrollToLatest = () => {
      scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    };

    const frame = requestAnimationFrame(scrollToLatest);
    return () => cancelAnimationFrame(frame);
  }, [chatScrollKey]);

  useEffect(() => {
    void refreshState();
    // Load the persisted learner state once when the chat shell mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const messages = state?.messages ?? [];
    if (messages.length === 0) {
      return;
    }

    const pendingAssistantMessages = getPendingAssistantMessagesForTts(
      messages,
      lastSpokenIdRef.current,
    );
    if (pendingAssistantMessages.length === 0) {
      return;
    }

    void (async () => {
      for (const message of pendingAssistantMessages) {
        currentlySpeakingMessageIdRef.current = message.id;
        const completed = await speakAssistantMessage(message);
        if (!completed) {
          break;
        }
        lastSpokenIdRef.current = message.id;
        currentlySpeakingMessageIdRef.current = null;
      }
    })();
    // Playback queues assistant messages only after the latest user turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.messages]);

  return (
    <main className="page">
      <section className="chat-stage">
        <header className="chat-header">
          <div>
            <p className="eyebrow">AI English Teacher POC</p>
            <h1>Riva Teacher</h1>
            <p className="lede">Personalized spoken-English lessons — Hinglish se seekho</p>
          </div>
          <div className="button-row">
            {state?.profile.username ? (
              <span className="header-username" aria-label={`Signed in as ${state.profile.username}`}>
                @{state.profile.username}
              </span>
            ) : null}
            <button className="danger" type="button" onClick={reset}>
              Sign out
            </button>
          </div>
        </header>

        <div className="chat-body">
          {state?.missingApiKey ? (
            <div className="notice">
              Add `OPENROUTER_API_KEY` (LLM + default TTS), `ELEVENLABS_API_KEY` (STT), and
              `VERTEX_API_KEY` (only when `TTS_PROVIDER=vertex`) to `.env` before using AI and speech
              features.
            </div>
          ) : null}
          {error ? <div className="error">{error}</div> : null}

          {!state && loading ? (
            <StageLoader label={loading} />
          ) : (
            <MessageList messages={displayMessages} currentStep={state?.currentStep ?? null} />
          )}

          {needsLevel ? (
            <LevelSuggestions disabled={Boolean(loading) || composerBusy} onSelectLevel={selectLevel} />
          ) : null}

          {hasCurriculum && !hasActiveTopic ? (
            <TopicSuggestions
              topics={pendingTopics}
              level={state?.profile.selfDeclaredLevel}
              disabled={Boolean(loading) || composerBusy}
              onSelectTopic={selectTopic}
            />
          ) : null}

          {state &&
          (loading || composerPhase === "waitingForRiva" || composerPhase === "transcribing") ? (
            <RivaThinkingIndicator
              label={
                loading ||
                (composerPhase === "transcribing"
                  ? loadingLabel("transcribing", learnerLevel)
                  : loadingLabel("thinking", learnerLevel))
              }
            />
          ) : null}
          <div ref={scrollAnchorRef} className="chat-scroll-anchor" aria-hidden="true" />
        </div>

        {needsUsername ? (
          <UsernameModal
            disabled={Boolean(loading)}
            serverError={error}
            onSubmit={async (username) => {
              await run(loadingLabel("signIn"), async () => {
                await submitUsernameAnswer(username);
              });
            }}
          />
        ) : (
          <Composer
            mode={composerMode}
            level={learnerLevel}
            disabled={Boolean(loading) || composerMode === "blocked" || composerBusy}
            micDisabled={micDisabled}
            phase={composerPhase}
            recording={recordingTarget === composerMode}
            onToggleRecord={() => {
              if (micDisabled || composerMode === "blocked") {
                return;
              }

              recordingTarget === composerMode ? stopRecording() : startRecording(composerMode);
            }}
            onDiscardRecording={discardRecording}
          />
        )}
      </section>
    </main>
  );
}

function UsernameModal(props: {
  disabled: boolean;
  serverError: string;
  onSubmit: (username: string) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [validationError, setValidationError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError("");

    try {
      const normalized = parseUsernameInput(username);
      await props.onSubmit(normalized);
    } catch (caught) {
      setValidationError(caught instanceof Error ? caught.message : "Username valid nahi hai.");
    }
  }

  const displayError = validationError || props.serverError;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="username-modal-title">
      <div className="modal-card setup-card">
        <h2 id="username-modal-title">Apna username daalein</h2>
        <p className="subtle">
          Naya username chuno ya purane se wapas sign in karein. Aapki conversation history har username ke
          saath save hoti hai.
        </p>
        <form className="stack" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="username-input">
              <span>Username</span>
            </label>
            <input
              id="username-input"
              name="username"
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              disabled={props.disabled}
              placeholder="e.g. dipesh"
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          {displayError ? <div className="error modal-error">{displayError}</div> : null}
          <div className="button-row">
            <button className="primary" type="submit" disabled={props.disabled || !username.trim()}>
              Aage badho
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LevelSuggestions(props: {
  disabled: boolean;
  onSelectLevel: (level: string) => void;
}) {
  return (
    <div className="message-row assistant-row">
      <div className="avatar">R</div>
      <div className="message assistant choice-message">
        <span className="message-meta">Riva</span>
        <strong>Apna current level chuno:</strong>
        <div className="topic-grid level-grid">
          {CEFR_LEVELS.map((level) => (
            <button
              key={level}
              className="topic-card level-card"
              type="button"
              disabled={props.disabled}
              onClick={() => props.onSelectLevel(level)}
            >
              <span className="pill">{level}</span>
              <h3>Level {level}</h3>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TopicSuggestions(props: {
  topics: AppState["topics"];
  level?: string | null;
  disabled: boolean;
  onSelectTopic: (topicId: string) => void;
}) {
  if (props.topics.length === 0) {
    return null;
  }

  return (
    <div className="message-row assistant-row">
      <div className="avatar">R</div>
      <div className="message assistant choice-message">
        <span className="message-meta">Riva</span>
        <strong>{topicSuggestionsUiLabel(props.level)}</strong>        <div className="topic-grid">
          {props.topics.map((topic) => (
            <button
              key={topic.id}
              className="topic-card"
              type="button"
              disabled={props.disabled}
              onClick={() => props.onSelectTopic(topic.id)}
            >
              <span className="pill">Suggested</span>
              <h3>{topic.title}</h3>
              <p>{topic.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AssistantMessageBody({
  message,
  currentStep,
}: {
  message: ChatMessageDto;
  currentStep: LessonStepDto | null;
}) {
  const metadata = parseQuestionMetadata(message.metadata);
  const isQuestion = message.kind === "question";

  if (!isQuestion) {
    return message.content;
  }

  const isSar = metadata?.questionType === "sar";
  const expectedAnswer =
    metadata?.expectedAnswer ??
    (metadata?.stepId && currentStep?.id === metadata.stepId ? currentStep.expectedAnswer : null) ??
    "";
  const questionPrompt =
    metadata?.questionPrompt ??
    (metadata?.stepId && currentStep?.id === metadata.stepId ? currentStep.content : null) ??
    message.content;
  const introContent = sanitizeQuestionStepIntroReply(
    {
      type: "question",
      questionType: metadata?.questionType ?? "open_ended",
      content: questionPrompt ?? "",
      expectedAnswer: expectedAnswer || null,
    },
    message.content,
  );
  const graded = Boolean(metadata?.wordDiff);
  const sarWords =
    metadata?.wordDiff?.tokens ??
    expectedAnswer
      .split(/\s+/)
      .map((word) => word.trim())
      .filter(Boolean)
      .map((word) => ({ word, status: "pending" as const }));

  return (
    <>
      {introContent.trim() ? <p className="message-body">{introContent}</p> : null}
      <div className="message-question-section">
        {isSar ? (
          <>
            <p className="question-prompt">{metadata?.questionPrompt ?? SAR_QUESTION_PROMPT}</p>
            {sarWords.length > 0 ? (
              <div
                className="question-words"
                aria-label={graded ? "Aapke words ka match" : "Repeat karne ke liye words"}
              >
                {sarWords.map((token, index) => (
                  <span className={`question-word question-word-${token.status}`} key={`${token.word}-${index}`}>
                    {token.word}
                  </span>
                ))}
              </div>
            ) : null}
            {graded && metadata?.wordDiff ? (
              <p className="question-score">
                {metadata.wordDiff.correctCount} mein se {metadata.wordDiff.expectedCount} words match hue (
                {metadata.wordDiff.score}%)
              </p>
            ) : null}
          </>
        ) : (
          <p className="question-prompt">{questionPrompt}</p>
        )}
      </div>
    </>
  );
}

function LoaderSpinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`loader-spinner ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M12 3a9 9 0 0 1 9 9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function StageLoader({ label }: { label: string }) {
  return (
    <div className="stage-loader" role="status" aria-live="polite" aria-busy="true">
      <LoaderSpinner className="stage-loader-spinner" />
      <p className="stage-loader-label">{label}</p>
    </div>
  );
}

function RivaThinkingIndicator({ label }: { label: string }) {
  return (
    <div className="message-row assistant-row" aria-live="polite" aria-busy="true">
      <div className="avatar">R</div>
      <div className="message assistant riva-thinking">
        <span className="message-meta">Riva</span>
        <div className="thinking-shimmer">
          <LoaderSpinner className="thinking-spinner" />
          <span className="thinking-label">{label}</span>
        </div>
      </div>
    </div>
  );
}

function MessageList({
  messages,
  currentStep,
}: {
  messages: ChatMessageDto[];
  currentStep: LessonStepDto | null;
}) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="messages">
      {messages.map((message) => (
        <div
          className={`message-row ${message.role === "user" ? "user-row" : "assistant-row"}`}
          key={message.id}
        >
          {message.role !== "user" ? <div className="avatar">R</div> : null}
          <div className={`message ${message.role}`}>
            <span className="message-meta">{message.role === "user" ? "You" : "Riva"}</span>
            <AssistantMessageBody message={message} currentStep={currentStep} />
          </div>
          {message.role === "user" ? <div className="avatar user-avatar">Y</div> : null}
        </div>
      ))}
    </div>
  );
}

function MicIcon() {
  return (
    <svg className="composer-mic-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z"
        fill="currentColor"
      />
      <path
        d="M19 11v1a7 7 0 0 1-14 0v-1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path d="M12 18v3" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
      <path d="M8 21h8" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

function StopRecordingIcon() {
  return (
    <svg className="composer-mic-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
    </svg>
  );
}

function DiscardRecordingIcon() {
  return (
    <svg className="composer-discard-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
      <path d="m6 6 12 12" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

function TranscribingIcon() {
  return <LoaderSpinner className="composer-mic-icon" />;
}

function Composer(props: {
  mode: ComposerMode;
  level?: string | null;
  disabled: boolean;
  micDisabled: boolean;
  phase: ComposerPhase;
  recording: boolean;
  onToggleRecord: () => void;
  onDiscardRecording: () => void;
}) {
  if (props.mode === "blocked") {
    return null;
  }

  const micButtonDisabled = props.disabled || props.micDisabled;
  const englishOnly = (props.level ?? "").toUpperCase() === "C1" || (props.level ?? "").toUpperCase() === "C2";

  const micLabel =
    props.phase === "transcribing"
      ? englishOnly
        ? "Transcribing speech"
        : "Speech transcribe ho rahi hai"
      : props.phase === "waitingForRiva"
        ? englishOnly
          ? "Waiting for Riva"
          : "Riva ka jawab aa raha hai"
        : props.recording
          ? englishOnly
            ? "Stop recording"
            : "Recording band karein"
          : englishOnly
            ? "Speak"
            : "Boliye";

  return (
    <div className={`composer ${props.phase !== "idle" ? "composer-busy" : ""}`}>
      <div className="composer-controls">
        {props.recording ? (
          <button
            className="composer-discard"
            type="button"
            onClick={props.onDiscardRecording}
            aria-label="Recording cancel karein"
          >
            <DiscardRecordingIcon />
          </button>
        ) : null}
        <button
          className={`primary composer-mic ${props.recording ? "recording" : ""} ${props.phase === "transcribing" ? "transcribing" : ""}`}
          type="button"
          onClick={props.onToggleRecord}
          disabled={micButtonDisabled}
          aria-pressed={props.recording}
          aria-busy={props.phase !== "idle"}
          aria-label={micLabel}
        >
          {props.recording ? (
            <StopRecordingIcon />
          ) : props.phase === "transcribing" ? (
            <TranscribingIcon />
          ) : (
            <MicIcon />
          )}
        </button>
      </div>
      {props.phase === "transcribing" ? (
        <span className="composer-status" aria-live="polite">
          {loadingLabel("transcribing", props.level)}
        </span>
      ) : null}
    </div>
  );
}

function cleanSpokenText(text: string) {
  return stripUiInstructions(text).replace(/\s+/g, " ").trim();
}

function isTtsAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }

  return payload;
}
