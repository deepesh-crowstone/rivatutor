export type WordDiffToken = {
  word: string;
  status: "correct" | "incorrect" | "missing" | "extra";
};

export type ExpectedWordStatus = "correct" | "incorrect" | "missing" | "pending";

export type ExpectedWordToken = {
  word: string;
  status: ExpectedWordStatus;
};

export const SAR_PASS_THRESHOLD = 80;

export function isSarPassingScore(score: number): boolean {
  return score >= SAR_PASS_THRESHOLD;
}

export type WordDiffResult = {
  expected: string;
  actual: string;
  tokens: WordDiffToken[];
  correctCount: number;
  expectedCount: number;
  score: number;
};

export function diffTranscript(expected: string, actual: string): WordDiffResult {
  const expectedWords = tokenize(expected);
  const actualWords = tokenize(actual);
  const lcs = buildLcsMatrix(expectedWords, actualWords);
  const tokens: WordDiffToken[] = [];

  let i = 0;
  let j = 0;
  while (i < expectedWords.length && j < actualWords.length) {
    if (expectedWords[i].normalized === actualWords[j].normalized) {
      tokens.push({ word: expectedWords[i].display, status: "correct" });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      tokens.push({ word: expectedWords[i].display, status: "missing" });
      i += 1;
    } else {
      tokens.push({ word: actualWords[j].display, status: "extra" });
      j += 1;
    }
  }

  while (i < expectedWords.length) {
    tokens.push({ word: expectedWords[i].display, status: "missing" });
    i += 1;
  }

  while (j < actualWords.length) {
    tokens.push({ word: actualWords[j].display, status: "extra" });
    j += 1;
  }

  const compacted = compactMissingExtra(tokens);
  const correctCount = compacted.filter((token) => token.status === "correct").length;
  const expectedCount = expectedWords.length;

  return {
    expected,
    actual,
    tokens: compacted,
    correctCount,
    expectedCount,
    score: expectedCount === 0 ? 0 : Math.round((correctCount / expectedCount) * 100),
  };
}

export function tokenizeExpectedWords(expected: string): ExpectedWordToken[] {
  return tokenize(expected).map((word) => ({
    word: word.display,
    status: "pending",
  }));
}

export function alignExpectedWords(expected: string, actual: string): ExpectedWordToken[] {
  const expectedWords = tokenize(expected);
  const actualWords = tokenize(actual);
  if (expectedWords.length === 0) {
    return [];
  }

  const lcs = buildLcsMatrix(expectedWords, actualWords);
  const tokens: ExpectedWordToken[] = [];

  let i = 0;
  let j = 0;
  while (i < expectedWords.length && j < actualWords.length) {
    if (expectedWords[i].normalized === actualWords[j].normalized) {
      tokens.push({ word: expectedWords[i].display, status: "correct" });
      i += 1;
      j += 1;
      continue;
    }

    if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      tokens.push({
        word: expectedWords[i].display,
        status: j < actualWords.length ? "incorrect" : "missing",
      });
      if (j < actualWords.length) {
        j += 1;
      }
      i += 1;
      continue;
    }

    j += 1;
  }

  while (i < expectedWords.length) {
    tokens.push({ word: expectedWords[i].display, status: "missing" });
    i += 1;
  }

  return tokens;
}

function tokenize(text: string) {
  return text
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .map((word) => ({
      display: word,
      normalized: word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""),
    }))
    .filter((word) => word.normalized.length > 0);
}

function buildLcsMatrix(
  expected: Array<{ normalized: string }>,
  actual: Array<{ normalized: string }>,
) {
  const matrix = Array.from({ length: expected.length + 1 }, () =>
    Array.from({ length: actual.length + 1 }, () => 0),
  );

  for (let i = expected.length - 1; i >= 0; i -= 1) {
    for (let j = actual.length - 1; j >= 0; j -= 1) {
      matrix[i][j] =
        expected[i].normalized === actual[j].normalized
          ? matrix[i + 1][j + 1] + 1
          : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
    }
  }

  return matrix;
}

function compactMissingExtra(tokens: WordDiffToken[]): WordDiffToken[] {
  const output: WordDiffToken[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    const next = tokens[index + 1];

    if (current.status === "missing" && next?.status === "extra") {
      output.push({ word: next.word, status: "incorrect" });
      index += 1;
      continue;
    }

    if (current.status === "extra" && next?.status === "missing") {
      output.push({ word: current.word, status: "incorrect" });
      index += 1;
      continue;
    }

    output.push(current);
  }

  return output;
}
