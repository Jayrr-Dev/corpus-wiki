// =====================================================================
// WORD DIFF: which words a proposed text keeps, adds and drops relative to
// the current one. Longest common subsequence over whitespace-split words;
// texts here are a sentence or two, so the quadratic table stays small.
// =====================================================================

export type DiffPart = { kind: "same" | "added" | "removed"; text: string };

// Largest input (in words, either side) worth diffing; longer texts show plain
const MAX_WORDS = 400;

export function wordDiff(current: string, proposed: string): DiffPart[] | null {
  const a = current.split(/\s+/).filter(Boolean);
  const b = proposed.split(/\s+/).filter(Boolean);
  if (a.length > MAX_WORDS || b.length > MAX_WORDS) return null;
  // Words match ignoring case and edge punctuation, so "documented" and "documented," count as kept
  const keyA = a.map(wordKey);
  const keyB = b.map(wordKey);
  // lcs(i, j) = LCS length of a[i..] and b[j..], kept in one flat row-major table
  const width = b.length + 1;
  const table = new Array<number>((a.length + 1) * width).fill(0);
  const lcs = (i: number, j: number) => table[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] = keyA[i] === keyB[j] ? lcs(i + 1, j + 1) + 1 : Math.max(lcs(i + 1, j), lcs(i, j + 1));
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], word: string) => {
    const last = parts.at(-1);
    if (last?.kind === kind) last.text += ` ${word}`;
    else parts.push({ kind, text: word });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const wordA = a[i];
    const wordB = b[j];
    if (wordA !== undefined && wordB !== undefined && keyA[i] === keyB[j]) {
      // Kept words show as the proposal writes them
      push("same", wordB);
      i++;
      j++;
    } else if (wordA !== undefined && (wordB === undefined || lcs(i + 1, j) >= lcs(i, j + 1))) {
      push("removed", wordA);
      i++;
    } else if (wordB !== undefined) {
      push("added", wordB);
      j++;
    }
  }
  return parts;
}

function wordKey(word: string): string {
  return word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}
