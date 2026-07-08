const USERNAME_PATTERN = /^[a-z0-9_-]{2,32}$/;

const USERNAME_INTRO_PATTERNS = [
  /^(?:my\s+username\s+is|username\s+is|username\s*[:=]|i\s*'?m|i\s+am|im|use|call\s+me)\s+(.+)$/i,
  /^@?(.+)$/,
] as const;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function parseUsernameInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Please tell Riva a username.");
  }

  let candidate = trimmed.split("\n")[0]?.trim() ?? "";
  for (const pattern of USERNAME_INTRO_PATTERNS) {
    const match = candidate.match(pattern);
    if (match?.[1]) {
      candidate = match[1].trim();
      break;
    }
  }

  candidate = candidate.replace(/^@+/, "").replace(/[.!?,;:]+$/g, "").trim();
  const normalized = normalizeUsername(candidate);

  if (normalized.length < 2) {
    throw new Error("Usernames must be at least 2 characters.");
  }

  if (!USERNAME_PATTERN.test(normalized)) {
    throw new Error("Use 2–32 lowercase letters, numbers, underscores, or hyphens.");
  }

  return normalized;
}
