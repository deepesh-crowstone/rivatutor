import { describe, expect, it } from "vitest";
import { TtsSessionTracker } from "@/lib/tts-session";

describe("TtsSessionTracker", () => {
  it("keeps the same session active across sequential segments", () => {
    const tracker = new TtsSessionTracker();
    const sessionId = tracker.currentSessionId();

    const first = tracker.beginSegment();
    const second = tracker.beginSegment();

    expect(first.sessionId).toBe(sessionId);
    expect(second.sessionId).toBe(sessionId);
    expect(first.segmentId).toBeLessThan(second.segmentId);
    expect(tracker.isSessionActive(sessionId)).toBe(true);
    expect(tracker.isPlaybackActive(sessionId, second.segmentId)).toBe(true);
    expect(tracker.isPlaybackActive(sessionId, first.segmentId)).toBe(false);
  });

  it("invalidates the active session and segments on abort", () => {
    const tracker = new TtsSessionTracker();
    const sessionId = tracker.currentSessionId();
    const { segmentId } = tracker.beginSegment();

    tracker.abort();

    expect(tracker.isSessionActive(sessionId)).toBe(false);
    expect(tracker.isPlaybackActive(sessionId, segmentId)).toBe(false);
    expect(tracker.currentSessionId()).toBe(sessionId + 1);
  });
});
