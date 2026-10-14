// =====================================================================
// WORD DIFF: splits two texts into words (keeping the spaces) and marks
// each piece as kept, removed or added, using a longest common subsequence.
// Texts here are one-sentence claims, so the O(n·m) table stays tiny.
// =====================================================================

export type DiffPart = { kind: "same" | "removed" | "added"; text: string };

// Splits text into words and the whitespace between them
export function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

// LCS lengths from the end: table[i][j] = common length of a[i..] and b[j..]
function lcsTable(a: string[], b: string[]): number[][] {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = table[i] as number[];
      row[j] = a[i] === b[j] ? (table[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(table[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  return table;
}

// Appends a piece, joining it to the previous one when the kind is the same
function push(parts: DiffPart[], kind: DiffPart["kind"], text: string): void {
  const last = parts[parts.length - 1];
  if (last?.kind === kind) last.text += text;
  else parts.push({ kind, text });
}

// Diffs `before` against `after`, word by word
export function diffWords(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const table = lcsTable(a, b);
  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(parts, "same", a[i++] as string);
      j++;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) push(parts, "removed", a[i++] as string);
    else push(parts, "added", b[j++] as string);
  }
  while (i < a.length) push(parts, "removed", a[i++] as string);
  while (j < b.length) push(parts, "added", b[j++] as string);
  return parts;
}
