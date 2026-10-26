import type { NliScorer, NliScores } from "@/lib/ai/nli";

// SHARED DUPLICATE PREFILTER: every duplicate check (claims, glossary, later entities and topics) passes
// its candidate list through here before its own LLM call. It drops only candidates the NLI model is
// confident are unrelated in both directions; everything else, contradictions included, goes on to the
// caller's own judge and merge rules. Callers skip their LLM call when `keep` is empty.
export type DedupItem = { id: string; text: string };
export type Relation = "same" | "adds_detail" | "contradicts" | "unrelated" | "unclear";

// "unrelated" needs neutral at least this high in BOTH directions. High on purpose: a wrong drop hides a
// real duplicate, while a wrong keep only costs one LLM call.
export const UNRELATED_MIN_NEUTRAL = 0.8;

const top = (scores: NliScores): keyof NliScores =>
  (["entailment", "contradiction", "neutral"] as const).reduce((best, label) => scores[label] > scores[best] ? label : best);

export async function relate(a: string, b: string, nli: NliScorer | null): Promise<Relation> {
  if (!nli) return "unclear";
  let forward: NliScores, backward: NliScores;
  try {
    [forward, backward] = [await nli.score(a, b), await nli.score(b, a)];
  } catch {
    return "unclear";
  }
  if (top(forward) === "contradiction" || top(backward) === "contradiction") return "contradicts";
  const entails = [forward, backward].filter((scores) => top(scores) === "entailment").length;
  if (entails === 2) return "same";
  if (entails === 1) return "adds_detail";
  if (forward.neutral >= UNRELATED_MIN_NEUTRAL && backward.neutral >= UNRELATED_MIN_NEUTRAL) return "unrelated";
  return "unclear";
}

export async function prefilter(item: DedupItem, candidates: DedupItem[], nli: NliScorer | null): Promise<{ keep: DedupItem[]; dropped: { id: string; relation: Relation }[] }> {
  if (!nli) return { keep: candidates, dropped: [] };
  const keep: DedupItem[] = [];
  const dropped: { id: string; relation: Relation }[] = [];
  // One at a time: the model runs on the server's CPU, so parallel calls only queue.
  for (const candidate of candidates) {
    const relation = await relate(item.text, candidate.text, nli);
    if (relation === "unrelated") dropped.push({ id: candidate.id, relation });
    else keep.push(candidate);
  }
  return { keep, dropped };
}
