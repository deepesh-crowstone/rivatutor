/** Tracks TTS session vs segment ids so user abort invalidates playback without breaking multi-segment speech. */
export class TtsSessionTracker {
  private sessionId = 0;
  private segmentId = 0;

  abort(): void {
    this.sessionId += 1;
    this.segmentId += 1;
  }

  beginSegment(): { sessionId: number; segmentId: number } {
    this.segmentId += 1;
    return { sessionId: this.sessionId, segmentId: this.segmentId };
  }

  currentSessionId(): number {
    return this.sessionId;
  }

  isSessionActive(sessionId: number): boolean {
    return sessionId === this.sessionId;
  }

  isPlaybackActive(sessionId: number, segmentId: number): boolean {
    return sessionId === this.sessionId && segmentId === this.segmentId;
  }
}
