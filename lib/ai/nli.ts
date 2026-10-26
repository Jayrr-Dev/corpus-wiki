import "server-only";
import { tmpdir } from "node:os";
import { join } from "node:path";

// NLI SCORER: a small local model (no API cost) that says whether one sentence follows from another
// (entailment), denies it (contradiction) or neither (neutral). On unless DEDUP_NLI=off (tests: off unless
// DEDUP_NLI=on, so they never download the model). The deduplicator
// uses it only to drop clearly unrelated candidates before an LLM call, never to confirm a duplicate:
// on swapped-word pairs ("the supervisor signs" vs "the attendant signs") it says "same" with certainty.
export type NliScores = { entailment: number; contradiction: number; neutral: number };
export type NliScorer = { model: string; score(premise: string, hypothesis: string): Promise<NliScores> };

export const NLI_MODEL = "cross-encoder/nli-deberta-v3-base";
const NLI_MODEL_FILE = "model_quint8_avx2";
// The model's config.json maps 0, 1, 2 this way; the loaded config is read first and this is the fallback.
const DEFAULT_LABELS: (keyof NliScores)[] = ["contradiction", "entailment", "neutral"];
// No verdict: neither direction is confident, so callers keep the candidate.
const NO_VERDICT: NliScores = { entailment: 0, contradiction: 0, neutral: 0 };

type Loaded = { run(premise: string, hypothesis: string): Promise<NliScores> };
type NliState = { pending?: Promise<Loaded>; failed?: boolean };
// MODEL: loaded once per process on first use and kept for the life of the server
const state = ((globalThis as { __nli?: NliState }).__nli ??= {});

async function load(): Promise<Loaded> {
  const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import("@huggingface/transformers");
  // Hosted servers can only write to the temp folder, where the downloaded model is cached
  if (process.env.VERCEL) env.cacheDir = join(tmpdir(), "transformers-cache");
  const [tokenizer, model] = await Promise.all([
    AutoTokenizer.from_pretrained(NLI_MODEL),
    AutoModelForSequenceClassification.from_pretrained(NLI_MODEL, { dtype: "fp32", model_file_name: NLI_MODEL_FILE }),
  ]);
  const id2label = (model.config as { id2label?: Record<string, string> }).id2label;
  const labels = DEFAULT_LABELS.map((fallback, index) => (id2label?.[index]?.toLowerCase() as keyof NliScores | undefined) ?? fallback);
  return {
    async run(premise, hypothesis) {
      const inputs = tokenizer(premise, { text_pair: hypothesis, truncation: true });
      const { logits } = await model(inputs);
      const values = Array.from(logits.data as Float32Array);
      const top = Math.max(...values);
      const exps = values.map((value) => Math.exp(value - top));
      const total = exps.reduce((sum, value) => sum + value, 0);
      const scores = { ...NO_VERDICT };
      labels.forEach((label, index) => { if (label in scores) scores[label] = exps[index]! / total; });
      return scores;
    },
  };
}

// The first failure is logged and turns NLI off for the rest of the process.
function fail(error: unknown): NliScores {
  if (!state.failed) console.warn("The NLI model failed; duplicate checks continue without it:", error);
  state.failed = true;
  return NO_VERDICT;
}

const scorer: NliScorer = {
  model: NLI_MODEL,
  async score(premise, hypothesis) {
    if (state.failed) return NO_VERDICT;
    try {
      state.pending ??= load();
      return await (await state.pending).run(premise, hypothesis);
    } catch (error) {
      return fail(error);
    }
  },
};

export function getNli(env: NodeJS.ProcessEnv = process.env): NliScorer | null {
  const on = env.NODE_ENV === "test" ? env.DEDUP_NLI === "on" : env.DEDUP_NLI !== "off";
  return on && !state.failed ? scorer : null;
}
