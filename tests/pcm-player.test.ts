import { beforeEach, describe, expect, it, vi } from "vitest";
import { PcmChunkPlayer } from "@/lib/pcm-player";

class MockAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  sampleRate = 24000;

  async resume() {
    return undefined;
  }

  createBuffer(_channels: number, length: number, _sampleRate: number) {
    return {
      duration: length / 24000,
      getChannelData: () => new Float32Array(length),
    };
  }

  createBufferSource() {
    return {
      buffer: null as AudioBuffer | null,
      connect: () => undefined,
      start: () => undefined,
    };
  }

  async close() {
    return undefined;
  }
}

describe("PcmChunkPlayer", () => {
  beforeEach(() => {
    vi.stubGlobal("AudioContext", MockAudioContext);
    vi.stubGlobal("window", {
      setTimeout: (callback: () => void) => {
        callback();
        return 1;
      },
    });
  });

  it("clears playing state when stopped", () => {
    const player = new PcmChunkPlayer();
    player.stop();
    expect(player.isPlaying).toBe(false);
  });

  it("returns false when playback is stopped mid-stream", async () => {
    const player = new PcmChunkPlayer();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0, 0, 1, 0]));
      },
      pull() {
        return new Promise<never>(() => {});
      },
    });
    const response = new Response(stream, {
      headers: {
        "Content-Type": "audio/l16",
        "X-Audio-Format": "pcm_s16le",
        "X-Audio-Sample-Rate": "24000",
      },
    });

    const playPromise = player.playResponse(response);
    await Promise.resolve();
    player.stop();

    await expect(playPromise).resolves.toBe(false);
    expect(player.isPlaying).toBe(false);
  });
});
