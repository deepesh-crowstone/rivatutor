import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TTS_VOICE_PROMPT,
  getOpenRouterTtsConfig,
  getTtsProvider,
  getVertexTtsConfig,
  hasRequiredApiKeys,
} from "@/lib/env";
import { int16PcmToFloat32, splitPcmBytes } from "@/lib/pcm";
import { formatVertexTtsInput, pcmToWav } from "@/lib/vertex-tts";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("TTS env parsing", () => {
  it("defaults to openrouter as the TTS provider", () => {
    delete process.env.TTS_PROVIDER;
    expect(getTtsProvider()).toBe("openrouter");
  });

  it("accepts vertex and elevenlabs as TTS providers", () => {
    process.env.TTS_PROVIDER = "vertex";
    expect(getTtsProvider()).toBe("vertex");

    process.env.TTS_PROVIDER = "elevenlabs";
    expect(getTtsProvider()).toBe("elevenlabs");
  });

  it("defaults to friendly teacher voice prompt when unset", () => {
    delete process.env.OPENROUTER_TTS_VOICE_PROMPT;
    delete process.env.VERTEX_TTS_VOICE_PROMPT;

    expect(getOpenRouterTtsConfig().voicePrompt).toBe(DEFAULT_TTS_VOICE_PROMPT);
    expect(getVertexTtsConfig().voicePrompt).toBe(DEFAULT_TTS_VOICE_PROMPT);
  });

  it("reads openrouter TTS settings from env", () => {
    process.env.OPENROUTER_TTS_MODEL = "google/gemini-3.1-flash-tts-preview";
    process.env.OPENROUTER_TTS_VOICE = "Puck";
    process.env.OPENROUTER_TTS_VOICE_PROMPT = "Say warmly";

    expect(getOpenRouterTtsConfig()).toEqual({
      model: "google/gemini-3.1-flash-tts-preview",
      voice: "Puck",
      voicePrompt: "Say warmly",
    });
  });

  it("reads vertex TTS settings from env", () => {
    process.env.VERTEX_API_KEY = "test-key";
    process.env.VERTEX_TTS_MODEL = "gemini-3.1-flash-tts-preview";
    process.env.VERTEX_TTS_VOICE = "Puck";
    process.env.VERTEX_TTS_VOICE_PROMPT = "Say warmly";

    expect(getVertexTtsConfig()).toEqual({
      apiKey: "test-key",
      model: "gemini-3.1-flash-tts-preview",
      voice: "Puck",
      voicePrompt: "Say warmly",
    });
  });

  it("requires only openrouter key when openrouter TTS and STT are selected", () => {
    process.env.TTS_PROVIDER = "openrouter";
    process.env.STT_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "llm";
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.VERTEX_API_KEY;

    expect(hasRequiredApiKeys()).toBe(true);
  });

  it("requires vertex key when vertex TTS is selected", () => {
    process.env.TTS_PROVIDER = "vertex";
    process.env.STT_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "llm";
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.VERTEX_API_KEY;

    expect(hasRequiredApiKeys()).toBe(false);

    process.env.VERTEX_API_KEY = "tts";
    expect(hasRequiredApiKeys()).toBe(true);
  });

  it("does not require vertex key when elevenlabs TTS is selected", () => {
    process.env.TTS_PROVIDER = "elevenlabs";
    process.env.STT_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "llm";
    process.env.ELEVENLABS_API_KEY = "tts";
    delete process.env.VERTEX_API_KEY;

    expect(hasRequiredApiKeys()).toBe(true);
  });
});

describe("vertex TTS helpers", () => {
  it("prefixes spoken text with the voice prompt", () => {
    expect(formatVertexTtsInput("Hello there.", "Say cheerfully")).toBe(
      "Say cheerfully: Hello there.",
    );
  });

  it("returns the original text when no voice prompt is set", () => {
    expect(formatVertexTtsInput("Hello there.", "")).toBe("Hello there.");
  });

  it("wraps PCM audio in a playable WAV container", () => {
    const pcm = new Uint8Array([0, 1, 2, 3]);
    const wav = pcmToWav(pcm);
    const view = new DataView(wav);

    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe(
      "RIFF",
    );
    expect(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))).toBe(
      "WAVE",
    );
    expect(wav.byteLength).toBe(48);
  });
});

describe("PCM helpers", () => {
  it("converts signed 16-bit PCM to normalized float samples", () => {
    const pcm = new Uint8Array([0, 0, 0xff, 0x7f]);
    const floats = int16PcmToFloat32(pcm);

    expect(floats.length).toBe(2);
    expect(floats[0]).toBe(0);
    expect(floats[1]).toBeCloseTo(32767 / 32768, 4);
  });

  it("buffers odd trailing bytes across chunk boundaries", () => {
    const first = splitPcmBytes(new Uint8Array(0), new Uint8Array([0x01]));
    expect(first.complete.length).toBe(0);
    expect(Array.from(first.remainder)).toEqual([0x01]);

    const second = splitPcmBytes(first.remainder, new Uint8Array([0x02, 0x03, 0x04]));
    expect(Array.from(second.complete)).toEqual([0x01, 0x02, 0x03, 0x04]);
    expect(second.remainder.length).toBe(0);
  });
});
