import { ANTHROPIC_MODEL_PREFIX, CEREBRAS_MODEL_PREFIX } from "./config";
import limits from "./modelLimits.json";
import { OPENROUTER_MODEL_PREFIX } from "./openrouterConfig";

// =====================================================================
// MODEL LIMITS: the real limits each provider publishes, downloaded into
// modelLimits.json by scripts/ai/fetch-model-limits.mjs. A call's max_tokens
// comes from here, so thinking never uses up a hand-picked ceiling.
// =====================================================================

export type ModelLimit = { contextTokens: number; maxOutputTokens?: number };

const PROVIDERS: Record<string, Record<string, ModelLimit>> = limits.providers;

// Prompts run from about 3 to 4 characters a token, but JSON runs denser and the schema is
// sent twice. Too low a count fails the whole call, so this errs well to the safe side.
const CHARS_PER_TOKEN = 2;
// Message wrappers and tool text the character count leaves out
const PROMPT_MARGIN_TOKENS = 1_000;
// An oversized prompt still gets a real answer budget; the provider then says it is too long
const MIN_ANSWER_TOKENS = 1_024;

// The published limit for a model as the app names it, or null when none is known
export function modelLimit(model: string): ModelLimit | null {
  if (model.startsWith(CEREBRAS_MODEL_PREFIX)) return null;
  if (model.startsWith(ANTHROPIC_MODEL_PREFIX)) return PROVIDERS.anthropic?.[model.slice(ANTHROPIC_MODEL_PREFIX.length).toLowerCase()] ?? null;
  if (model.startsWith(OPENROUTER_MODEL_PREFIX)) return PROVIDERS.openrouter?.[model.slice(OPENROUTER_MODEL_PREFIX.length).toLowerCase()] ?? null;
  return PROVIDERS.nebius?.[model.slice(model.lastIndexOf("/") + 1).toLowerCase()] ?? null;
}

// The most this call can answer: the window left after the prompt, up to the model's own
// answer limit. Null when the model has no published limit, and the caller's cap stands.
export function answerRoom(model: string, promptChars: number): number | null {
  const limit = modelLimit(model);
  if (!limit) return null;
  const room = limit.contextTokens - Math.ceil(promptChars / CHARS_PER_TOKEN) - PROMPT_MARGIN_TOKENS;
  return Math.max(MIN_ANSWER_TOKENS, Math.min(room, limit.maxOutputTokens ?? room));
}
