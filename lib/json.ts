export function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function parseMetadata(value: string | null): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

/** Remove trailing commas and other common LLM JSON mistakes. */
export function repairJsonText(text: string): string {
  return text
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2018|\u2019/g, "'");
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Extract the first balanced `{ ... }` object from text. */
export function findBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();

  const attempts = [
    candidate,
    repairJsonText(candidate),
    findBalancedJsonObject(candidate),
    findBalancedJsonObject(repairJsonText(candidate)),
  ].filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index);

  for (const attempt of attempts) {
    const parsed = tryParseJson(attempt);
    if (parsed !== null && typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed;
    }

    const repaired = repairJsonText(attempt);
    if (repaired !== attempt) {
      const repairedParsed = tryParseJson(repaired);
      if (
        repairedParsed !== null &&
        typeof repairedParsed === "object" &&
        repairedParsed !== null &&
        !Array.isArray(repairedParsed)
      ) {
        return repairedParsed;
      }
    }
  }

  const balanced = findBalancedJsonObject(candidate);
  if (balanced) {
    const parsed = tryParseJson(repairJsonText(balanced));
    if (parsed !== null) {
      return parsed;
    }
  }

  throw new Error("The model response did not contain a JSON object.");
}
