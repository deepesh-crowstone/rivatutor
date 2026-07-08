import { int16PcmToFloat32, splitPcmBytes } from "@/lib/pcm";

type PcmPlayerOptions = {
  sampleRate?: number;
  onPlayingChange?: (playing: boolean) => void;
};

export class PcmChunkPlayer {
  private context: AudioContext | null = null;
  private nextStartTime = 0;
  private remainder = new Uint8Array(0);
  private generation = 0;
  private playing = false;
  private sampleRate: number;
  private onPlayingChange?: (playing: boolean) => void;

  constructor(options: PcmPlayerOptions = {}) {
    this.sampleRate = options.sampleRate ?? 24000;
    this.onPlayingChange = options.onPlayingChange;
  }

  get isPlaying() {
    return this.playing;
  }

  stop() {
    this.generation += 1;
    this.remainder = new Uint8Array(0);
    this.nextStartTime = 0;

    if (this.context) {
      void this.context.close();
      this.context = null;
    }

    this.setPlaying(false);
  }

  /** Call from a user gesture (e.g. mic click) so AudioContext can play on HTTPS. */
  async prepareForPlayback(): Promise<void> {
    const context = await this.ensureContext();
    if (context.state === "suspended") {
      await context.resume();
    }
  }

  async playResponse(response: Response): Promise<boolean> {
    const playGeneration = this.generation + 1;
    this.stop();
    this.generation = playGeneration;

    const sampleRateHeader = response.headers.get("X-Audio-Sample-Rate");
    if (sampleRateHeader) {
      this.sampleRate = Number(sampleRateHeader) || this.sampleRate;
    }

    const body = response.body;
    if (!body) {
      return false;
    }

    const context = await this.ensureContext();
    this.setPlaying(true);

    const reader = body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (this.generation !== playGeneration) {
          return false;
        }
        if (done) {
          break;
        }
        if (value?.length) {
          this.enqueuePcm(value, context, playGeneration);
        }
      }

      this.remainder = new Uint8Array(0);
      await this.waitForScheduledAudio(context, playGeneration);
      return this.generation === playGeneration;
    } catch (error) {
      console.warn("[riva-tts] PCM playback failed:", error);
      return false;
    } finally {
      if (this.generation === playGeneration) {
        this.setPlaying(false);
      }
    }
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.context) {
      this.context = new AudioContext({ sampleRate: this.sampleRate });
    }

    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    return this.context;
  }

  private enqueuePcm(chunk: Uint8Array, context: AudioContext, playGeneration: number) {
    if (this.generation !== playGeneration) {
      return;
    }

    const split = splitPcmBytes(this.remainder, chunk);
    this.remainder = new Uint8Array(split.remainder);

    if (split.complete.length === 0) {
      return;
    }

    const floats = int16PcmToFloat32(split.complete);
    if (floats.length === 0) {
      return;
    }

    const buffer = context.createBuffer(1, floats.length, this.sampleRate);
    buffer.getChannelData(0).set(floats);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    const startAt = Math.max(context.currentTime, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
  }

  private waitForScheduledAudio(context: AudioContext, playGeneration: number): Promise<void> {
    const remainingSeconds = this.nextStartTime - context.currentTime;
    if (remainingSeconds <= 0 || this.generation !== playGeneration) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      window.setTimeout(resolve, remainingSeconds * 1000 + 40);
    });
  }

  private setPlaying(playing: boolean) {
    if (this.playing === playing) {
      return;
    }

    this.playing = playing;
    this.onPlayingChange?.(playing);
  }
}

export function isStreamingPcmResponse(response: Response): boolean {
  const contentType = (response.headers.get("Content-Type") ?? "").toLowerCase();
  const format = (response.headers.get("X-Audio-Format") ?? "").toLowerCase();

  return (
    format === "pcm_s16le" ||
    contentType.includes("audio/l16") ||
    contentType.includes("audio/pcm")
  );
}
