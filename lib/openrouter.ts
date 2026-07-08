import type { z } from "zod";
import { OPENROUTER_CHAT_MODEL, getOpenRouterConfig, requireOpenRouterApiKey } from "@/lib/env";
import { extractJsonObject } from "@/lib/json";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const JSON_RETRY_HINT =
  "Your previous reply was not valid JSON. Return one JSON object only. No markdown fences, no commentary, and no trailing commas in arrays or objects.";

export async function callOpenRouterJson<T>(
  messages: ChatMessage[],
  schema: z.ZodType<T>,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const attemptMessages =
      attempt === 0
        ? messages
        : [
            ...messages,
            {
              role: "system" as const,
              content: JSON_RETRY_HINT,
            },
          ];

    try {
      const content = await callOpenRouterText(attemptMessages, true);
      const parsed = schema.safeParse(extractJsonObject(content));

      if (parsed.success) {
        return parsed.data;
      }

      lastError = new Error(`Riva received invalid JSON from the model: ${parsed.error.message}`);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Riva could not parse a valid JSON response from the model.");
}

export async function callOpenRouterText(
  messages: ChatMessage[],
  jsonMode = false,
): Promise<string> {
  const apiKey = requireOpenRouterApiKey();
  const config = getOpenRouterConfig();
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: openRouterHeaders(apiKey, config.siteUrl, config.appTitle),
    body: JSON.stringify({
      model: OPENROUTER_CHAT_MODEL,
      messages,
      temperature: 0.35,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(await openRouterError(response, "chat completion"));
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenRouter returned an empty chat response.");
  }

  return content;
}

function openRouterHeaders(apiKey: string, siteUrl: string, appTitle: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": siteUrl,
    "X-OpenRouter-Title": appTitle,
  };
}

async function openRouterError(response: Response, label: string) {
  const text = await response.text();
  return `OpenRouter ${label} failed (${response.status}): ${text}`;
}
