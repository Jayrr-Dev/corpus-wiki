import { contentWords } from "@/lib/graph/related";

// =====================================================================
// CLAIM SIMILARITY: how "these two claims may say the same thing" is
// measured, shared by the ingest guard (lib/ingest/duplicateGuard.ts) and
// the cleaning cycle (lib/ai/tokenFactory/dedupePass.ts). A score only
// picks candidates; the AI judge decides what is really a duplicate.
//
// Thresholds were set on the Utilitek safety program with
// Qwen/Qwen3-Embedding-8B at 1024 dims: reworded copies of one claim
// scored 0.94-1.00, different claims on one topic 0.78-0.91, unrelated
// claims about 0.56.
// =====================================================================

// Cosine at which two claims are close enough for the judge to compare
export const CANDIDATE_COSINE = 0.85;
// Cosine at which a merge the judge is sure of applies without a person
export const AUTO_MERGE_COSINE = 0.94;
// Without embeddings: share of the shorter claim's content words the longer one has
export const CANDIDATE_OVERLAP = 0.6;
// Claims this short match too easily on word overlap alone
const MIN_WORDS = 4;

// One claim's text as compared: case, spacing, Unicode forms and the final stop ignored
export function normalizeClaim(text: string): string {
  return text.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
}

export function sameClaimText(a: string, b: string): boolean {
  const left = normalizeClaim(a);
  return Boolean(left) && left === normalizeClaim(b);
}

export function wordSet(text: string): Set<string> {
  return new Set(contentWords(text));
}

// Overlap coefficient of two word sets: |A ∩ B| / min(|A|, |B|)
export function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size === 0) return 0;
  let shared = 0;
  for (const word of small) if (large.has(word)) shared++;
  return shared / small.size;
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    left += a[i]! * a[i]!;
    right += b[i]! * b[i]!;
  }
  return left && right ? dot / Math.sqrt(left * right) : 0;
}

// A CLAIM READY TO COMPARE: its normalized text, words and (when embedded) vector
export type ComparableClaim = { normalized: string; words: Set<string>; vector: readonly number[] | null };

export function comparable(text: string, vector: readonly number[] | null = null): ComparableClaim {
  return { normalized: normalizeClaim(text), words: wordSet(text), vector };
}

// HOW ALIKE TWO CLAIMS ARE: 1 for the same text, else the cosine when both are embedded,
// else the word overlap. `candidate` says whether the judge should compare them;
// `cosine` is null when the score is not an embedding similarity.
export type Likeness = { score: number; candidate: boolean; exact: boolean; cosine: number | null };

export function likeness(a: ComparableClaim, b: ComparableClaim): Likeness {
  if (a.normalized && a.normalized === b.normalized) return { score: 1, candidate: true, exact: true, cosine: 1 };
  if (a.vector && b.vector) {
    const score = cosine(a.vector, b.vector);
    return { score, candidate: score >= CANDIDATE_COSINE, exact: false, cosine: score };
  }
  const enoughWords = a.words.size >= MIN_WORDS && b.words.size >= MIN_WORDS;
  const score = enoughWords ? overlap(a.words, b.words) : 0;
  return { score, candidate: score >= CANDIDATE_OVERLAP, exact: false, cosine: null };
}
