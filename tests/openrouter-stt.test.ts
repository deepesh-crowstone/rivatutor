import { afterEach, describe, expect, it, vi } from "vitest";
import { getOpenRouterSttConfig, getSttProvider, hasRequiredApiKeys } from "@/lib/env";

describe("STT provider config", () => {
  afterEach(() => {
    delete process.env.STT_PROVIDER;
    delete process.env.OPENROUTER_STT_MODEL;
    delete process.env.OPENROUTER_STT_LANGUAGE;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.TTS_PROVIDER;
    delete process.env.VERTEX_API_KEY;
  });

  it("defaults to OpenRouter Chirp 3", () => {
    delete process.env.STT_PROVIDER;
    expect(getSttProvider()).toBe("openrouter");
    expect(getOpenRouterSttConfig()).toEqual({
      model: "google/chirp-3",
      language: "en",
    });
  });

  it("allows ElevenLabs STT when explicitly selected", () => {
    process.env.STT_PROVIDER = "elevenlabs";
    expect(getSttProvider()).toBe("elevenlabs");
  });

  it("does not require ElevenLabs when OpenRouter STT and TTS are used", () => {
    process.env.TTS_PROVIDER = "openrouter";
    process.env.STT_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "llm";
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.VERTEX_API_KEY;

    expect(hasRequiredApiKeys()).toBe(true);
  });

  it("requires ElevenLabs when STT_PROVIDER=elevenlabs", () => {
    process.env.TTS_PROVIDER = "openrouter";
    process.env.STT_PROVIDER = "elevenlabs";
    process.env.OPENROUTER_API_KEY = "llm";
    delete process.env.ELEVENLABS_API_KEY;

    expect(hasRequiredApiKeys()).toBe(false);

    process.env.ELEVENLABS_API_KEY = "stt";
    expect(hasRequiredApiKeys()).toBe(true);
  });
});

describe("transcribeAudioWithOpenRouter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_STT_MODEL;
  });

  it("posts base64 audio to OpenRouter transcriptions", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.OPENROUTER_STT_MODEL = "google/chirp-3";

    const fetchMock = vi.fn(async () =>
      Response.json({ text: "  Hello from Chirp  " }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { transcribeAudioWithOpenRouter } = await import("@/lib/openrouter-stt");
    const text = await transcribeAudioWithOpenRouter({
      file: new Blob([Uint8Array.from([1, 2, 3])], { type: "audio/webm" }),
      format: "webm",
    });

    expect(text).toBe("Hello from Chirp");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/audio/transcriptions");
    const body = JSON.parse(String(init.body)) as {
      model: string;
      input_audio: { data: string; format: string };
      language?: string;
    };
    expect(body.model).toBe("google/chirp-3");
    expect(body.input_audio.format).toBe("webm");
    expect(body.input_audio.data.length).toBeGreaterThan(0);
    expect(body.language).toBe("en");
  });
});
