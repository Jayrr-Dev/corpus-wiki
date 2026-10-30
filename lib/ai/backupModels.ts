import { ANTHROPIC_MODEL_PREFIX, CEREBRAS_MODEL_PREFIX } from "./config";
import { AiInactivityError } from "./inactivityTimeout";
import { OPENROUTER_MODEL_PREFIX } from "./openrouterConfig";
import { priceFor } from "./pricing";

// =====================================================================
// BACKUP MODELS: when the picked model's provider fails (overloaded, stalled,
// out of credit, down), the same request goes to a model on another connected
// provider, picked automatically. Backups are ordered by one simple index, lower first:
//   index = wc * cost / dearest + ws * (1 - speed / fastest) + wi * (1 - intelligence / smartest)
// with weights per role (ROLE_WEIGHTS): judgment roles favour intelligence, bulk roles
// favour cost and speed.
// cost is the blended price per 1M tokens (3 parts input to 1 part output),
// speed the latest AI Speed test (tokens per second), intelligence the
// published score below. A value nobody knows counts as the middle (0.5).
// =====================================================================

// INTELLIGENCE: the Artificial Analysis Intelligence Index (0-100), from
// https://artificialanalysis.ai/leaderboards/models, read 2026-10-30. The app's calls run at
// medium effort, so a model's medium score is used where listed, otherwise its listed score.
// Models the leaderboard does not score (Mercury 3, Kimi K3, gpt-oss-120b, Llama 3.3) are left out.
export const INTELLIGENCE_CHECKED_ON = "2026-10-30";
export const MODEL_INTELLIGENCE: Record<string, number> = {
  "claude-opus-5-5": 48,
  "claude-fable-5-1": 43,
  "claude-sonnet-5-5": 30,
  "claude-haiku-5-5": 25,
  "GLM-5.3": 32,
  "DeepSeek-V4.1-Flash": 32,
  "GLM-5.3-Flash": 28,
  "DeepSeek-V4-Pro-0813": 23,
  "MiniMax-M3": 19,
  "Qwen3.8-27B": 17,
  "Nemotron-3.5-Super-VL": 14,
  "Nemotron-3-Ultra-550b-a55b": 12,
  "Nemotron-3_5-Lightning": 6,
};

// Backups tried when AI_BACKUP_MODELS is not set, per connected provider
const DEFAULT_BACKUPS: { key: string; models: string[] }[] = [
  { key: "ANTHROPIC_API_KEY", models: [`${ANTHROPIC_MODEL_PREFIX}claude-haiku-5-5`, `${ANTHROPIC_MODEL_PREFIX}claude-sonnet-5-5`] },
  { key: "OPENROUTER_API_KEY", models: [`${OPENROUTER_MODEL_PREFIX}inception/mercury-3`] },
];

// WEIGHTS PER ROLE: cost, speed, intelligence
export type BackupWeights = { cost: number; speed: number; intelligence: number };
const EQUAL: BackupWeights = { cost: 1, speed: 1, intelligence: 1 };
const JUDGMENT: BackupWeights = { cost: 1, speed: 1, intelligence: 3 };
const WRITING: BackupWeights = { cost: 1, speed: 2, intelligence: 2 };
const BULK: BackupWeights = { cost: 2, speed: 2, intelligence: 1 };
export const ROLE_WEIGHTS: Record<string, BackupWeights> = {
  reconciler: JUDGMENT, article_reviewer: JUDGMENT, reviewer: JUDGMENT, domain_decider: JUDGMENT, domain_steward: JUDGMENT,
  plan_articles: JUDGMENT, curator: JUDGMENT, researcher: JUDGMENT,
  write_articles: WRITING, composer: WRITING, docs_writer: WRITING, tutor: WRITING, narrator: WRITING,
  deduplicator: BULK, identify_entities: BULK, dictionary_editor: BULK, define_concepts: BULK, link_knowledge: BULK,
  sourcer: BULK, media_analyst: BULK,
};
export const weightsFor = (role: string | null): BackupWeights => (role ? ROLE_WEIGHTS[role] : undefined) ?? EQUAL;

export type BackupCandidate = { model: string; costPerM: number | null; tokensPerSecond: number | null; intelligence: number | null };

// Which provider serves a model id
export function providerOf(model: string): "anthropic" | "openrouter" | "cerebras" | "tokenfactory" {
  if (model.startsWith(ANTHROPIC_MODEL_PREFIX)) return "anthropic";
  if (model.startsWith(OPENROUTER_MODEL_PREFIX)) return "openrouter";
  if (model.startsWith(CEREBRAS_MODEL_PREFIX)) return "cerebras";
  return "tokenfactory";
}

// The tier of a model id (its name without provider prefixes), or null when unknown
export function intelligenceOf(model: string): number | null {
  return MODEL_INTELLIGENCE[model.split("/").pop() ?? model] ?? null;
}

// THE SHARE OF A CALL'S INPUT THAT IS A REPEATED PREFIX (system prompt, role instructions)
// a provider can serve from its prompt cache. An estimate to tune, not a measurement.
export const CACHED_INPUT_SHARE = 0.5;

// Blended price per 1M tokens with prompt caching, or null when the price table has none.
// Like estimateCost (./pricing.ts), Claude bills cached input at its cache-read rate and other models at their cached rate, if any.
export function blendedCostPerM(model: string): number | null {
  const price = priceFor(model.startsWith(ANTHROPIC_MODEL_PREFIX) ? model.slice(ANTHROPIC_MODEL_PREFIX.length) : model);
  if (!price) return null;
  const cacheRate = price.model.startsWith("claude-") ? (price.cacheReadMultiplier ?? 0.1) : (price.cachedInputPerM ?? price.inputPerM) / price.inputPerM;
  const inputPerM = price.inputPerM * (1 - CACHED_INPUT_SHARE + CACHED_INPUT_SHARE * cacheRate);
  return (3 * inputPerM + price.outputPerM) / 4;
}

// Lower is better; see the formula at the top
export function backupIndex(candidates: BackupCandidate[], weights: BackupWeights = EQUAL): { model: string; index: number }[] {
  const most = (values: (number | null)[]) => Math.max(0, ...values.filter((value): value is number => value != null && value > 0));
  const dearest = most(candidates.map((c) => c.costPerM));
  const fastest = most(candidates.map((c) => c.tokensPerSecond));
  const smartest = most(candidates.map((c) => c.intelligence));
  const part = (value: number | null, scale: number, score: (share: number) => number) => (value == null || scale <= 0 ? 0.5 : score(value / scale));
  return candidates
    .map((c) => ({
      model: c.model,
      index: weights.cost * part(c.costPerM, dearest, (share) => share)
        + weights.speed * part(c.tokensPerSecond, fastest, (share) => 1 - share)
        + weights.intelligence * part(c.intelligence, smartest, (share) => 1 - share),
    }))
    .sort((a, b) => a.index - b.index || a.model.localeCompare(b.model));
}

// The backups this server can reach, with what the index needs. speeds: latest tokens per second by model id
export function backupCandidates(env: Record<string, string | undefined>, speeds: Record<string, number | null> = {}): BackupCandidate[] {
  const listed = env.AI_BACKUP_MODELS?.split(",").map((model) => model.trim()).filter(Boolean);
  const models = listed?.length ? listed : DEFAULT_BACKUPS.flatMap((group) => (env[group.key] ? group.models : []));
  return [...new Set(models)].map((model) => ({
    model, costPerM: blendedCostPerM(model), tokensPerSecond: speeds[model] ?? null, intelligence: intelligenceOf(model),
  }));
}

// The backup models for one call's role, best first
export function rankedBackups(candidates: BackupCandidate[], role: string | null): string[] {
  return backupIndex(candidates, weightsFor(role)).map((ranked) => ranked.model);
}

// Failures of the provider, not of the request or the answer: worth trying another provider
const PROVIDER_STATUSES = new Set([401, 402, 403, 408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 529]);
export function isProviderFailure(error: unknown): boolean {
  if (error instanceof AiInactivityError) return true;
  if (!(error instanceof Error)) return false;
  if (error.name === "ProviderTimeoutError") return true;
  const status = /^[A-Za-z][\w .-]* (\d{3}): /.exec(error.message)?.[1];
  return status !== undefined && PROVIDER_STATUSES.has(Number(status));
}
