// =====================================================================
// AI PRICING: Token Factory list prices in US dollars per 1M tokens, used
// to estimate what the logged AI calls cost. Reasoning tokens bill as
// output. Prices change: update this table when Nebius changes theirs.
// Source: Nebius Token Factory pricing, checked 2026-10-15; Claude rows: Anthropic API list prices, checked 2026-10-16.
// =====================================================================

export const PRICES_CHECKED_ON = "2026-10-19 (Claude, embeddings, and OpenRouter Mercury 3); 2026-10-15 (Token Factory chat)";

export type ModelPrice = { model: string; inputPerM: number; outputPerM: number; cacheReadMultiplier?: number; longContext?: { above: number; inputPerM: number; outputPerM: number } };

// Keyed by the model name without its org prefix ("zai-org/GLM-5.3-Flash" -> "GLM-5.3-Flash")
export const MODEL_PRICES: readonly ModelPrice[] = [
  { model: "GLM-5.3-Flash", inputPerM: 0.15, outputPerM: 0.5 },
  { model: "GLM-5.3", inputPerM: 1.4, outputPerM: 4.4 },
  { model: "GLM-5.2", inputPerM: 1.4, outputPerM: 4.4 },
  { model: "GLM-5.1", inputPerM: 1.4, outputPerM: 4.4 },
  { model: "GLM-5", inputPerM: 1.0, outputPerM: 3.2 },
  { model: "nemotron-3-super-120b-a12b", inputPerM: 0.3, outputPerM: 0.9 },
  { model: "Nemotron-3-Ultra-550b-a55b", inputPerM: 1.0, outputPerM: 3.0 },
  { model: "NVIDIA-Nemotron-3-Nano-30B-A3B", inputPerM: 0.06, outputPerM: 0.24 },
  { model: "Nemotron-3-Nano-Omni", inputPerM: 0.06, outputPerM: 0.24 },
  { model: "Nemotron-3_5-Lightning", inputPerM: 0.06, outputPerM: 0.24 },
  { model: "DeepSeek-V4-Pro", inputPerM: 1.75, outputPerM: 3.5 },
  { model: "DeepSeek-V4-Flash", inputPerM: 0.14, outputPerM: 0.28 },
  { model: "DeepSeek-V4.1-Flash", inputPerM: 0.3, outputPerM: 1.2 },
  { model: "Kimi-K3", inputPerM: 3.0, outputPerM: 15.0 },
  { model: "Kimi-K2.6", inputPerM: 0.95, outputPerM: 4.0 },
  { model: "MiniMax-M3", inputPerM: 0.3, outputPerM: 1.2 },
  { model: "Qwen3.5-397B-A17B", inputPerM: 0.6, outputPerM: 3.6 },
  { model: "Qwen3-235B-A22B-Instruct-2507", inputPerM: 0.2, outputPerM: 0.6 },
  { model: "gpt-oss-120b", inputPerM: 0.15, outputPerM: 0.6 },
  { model: "Llama-3.3-70B-Instruct", inputPerM: 0.13, outputPerM: 0.4 },
  // https://tokenfactory.nebius.com/model-catalog.md, checked 2026-10-19.
  { model: "Qwen3-Embedding-8B", inputPerM: 0.01, outputPerM: 0 },
  { model: "Qwen3-30B-A3B-Instruct-2507", inputPerM: 0.1, outputPerM: 0.3 },
  { model: "Qwen3.8-27B", inputPerM: 0.45, outputPerM: 3 },
  { model: "DeepSeek-V4-Flash-0731", inputPerM: 0.14, outputPerM: 0.28 },
  { model: "DeepSeek-V4-Pro-0813", inputPerM: 1.32, outputPerM: 3.96 },
  { model: "gemma-3-27b-it", inputPerM: 0.1, outputPerM: 0.3 },
  { model: "muse-spark-open", inputPerM: 1.25, outputPerM: 4.25 },
  { model: "Hermes-4-405B", inputPerM: 1, outputPerM: 3 },
  { model: "Nemotron-3.5-Super-VL", inputPerM: 0.3, outputPerM: 0.9 },
  { model: "MiniCPM-V-4_5", inputPerM: 0.658, outputPerM: 1.11 },
  { model: "Kimi-K2.7-Code", inputPerM: 0.95, outputPerM: 4 },
  { model: "beam", inputPerM: 0.25, outputPerM: 1 },
  // https://platform.claude.com/docs/en/about-claude/pricing
  { model: "claude-fable-5-1", inputPerM: 10.0, outputPerM: 50.0, cacheReadMultiplier: 0.025 },
  { model: "claude-opus-5-5", inputPerM: 4.0, outputPerM: 20.0, cacheReadMultiplier: 0.05 },
  { model: "claude-opus-5", inputPerM: 5.0, outputPerM: 25.0 },
  { model: "claude-opus-4-8", inputPerM: 5.0, outputPerM: 25.0 },
  { model: "claude-sonnet-5-5", inputPerM: 2.0, outputPerM: 10.0, cacheReadMultiplier: 0.05 },
  { model: "claude-sonnet-5", inputPerM: 2.0, outputPerM: 10.0 },
  { model: "claude-haiku-5-5", inputPerM: 0.1, outputPerM: 0.5, longContext: { above: 100_000, inputPerM: 0.5, outputPerM: 2.5 } },
  { model: "claude-fable-5", inputPerM: 10, outputPerM: 50 },
  { model: "claude-opus-4-7", inputPerM: 5, outputPerM: 25 },
  { model: "claude-opus-4-6", inputPerM: 5, outputPerM: 25 },
  { model: "claude-sonnet-4-6", inputPerM: 3, outputPerM: 15 },
  { model: "claude-haiku-4-5", inputPerM: 1, outputPerM: 5 },
  // OpenRouter launch price for Mercury 3 ($0.10 / $0.35 per 1M). List price is $0.20 / $0.70.
  // https://openrouter.ai/inception/mercury-3 , checked 2026-10-19.
  { model: "inception/mercury-3", inputPerM: 0.1, outputPerM: 0.35 },
];

const BY_NAME = new Map(MODEL_PRICES.map((price) => [price.model.toLowerCase(), price]));

// The price for a model id, or null when the table has none
export function priceFor(model: string): ModelPrice | null {
  // These providers have their own rates, even for the same model name.
  if (model.startsWith("cerebras/")) return null;
  if (model.startsWith("openrouter/")) return BY_NAME.get(model.slice("openrouter/".length).toLowerCase()) ?? null;
  const name = model.split("/").pop() ?? model;
  return BY_NAME.get(name.toLowerCase()) ?? BY_NAME.get(name.toLowerCase().replace(/-\d{8}$/, "")) ?? null;
}

// Estimated dollars for some tokens on one model (null = unpriced model)
export function estimateCost(model: string, promptTokens: number, completionTokens: number, usageDetails?: unknown): number | null {
  const price = priceFor(model);
  if (!price) return null;
  if (![promptTokens, completionTokens].every((value) => Number.isFinite(value) && value >= 0)) return null;
  const rates = price.longContext && promptTokens > price.longContext.above ? price.longContext : price;
  const usage = usageDetails && typeof usageDetails === "object" ? usageDetails as Record<string, unknown> : {};
  if (Array.isArray(usage.billing_rounds) && usage.billing_rounds.length) {
    const costs = usage.billing_rounds.map((round: unknown) => {
      if (!round || typeof round !== "object") return null;
      const item = round as Record<string, unknown>;
      if (typeof item.prompt_tokens !== "number" || typeof item.completion_tokens !== "number") return null;
      return estimateCost(model, item.prompt_tokens, item.completion_tokens, item);
    });
    return costs.some((cost) => cost === null) ? null : costs.reduce<number>((sum, cost) => sum + cost!, 0);
  }
  const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
  const claude = price.model.startsWith("claude-");
  const read = claude ? count(usage.cache_read_input_tokens) : 0;
  const write = claude ? count(usage.cache_creation_input_tokens) : 0;
  const creation = usage.cache_creation as { ephemeral_1h_input_tokens?: number } | null | undefined;
  const hourWrite = claude ? count(creation?.ephemeral_1h_input_tokens) : 0;
  if (read + write > promptTokens || hourWrite > write) return null;
  const input = promptTokens - read - write;
  return (rates.inputPerM * (input + read * (price.cacheReadMultiplier ?? 0.1) + (write - hourWrite) * 1.25 + hourWrite * 2)
    + completionTokens * rates.outputPerM) / 1_000_000;
}

export type CostedCall = { model: string; prompt_tokens: number | null; completion_tokens: number | null; usage_details?: unknown };

// Missing provider usage is unknown spend, never a free request.
export function estimateCallCost(call: CostedCall): number | null {
  if (call.prompt_tokens === null || call.completion_tokens === null) return null;
  return estimateCost(call.model, call.prompt_tokens, call.completion_tokens, call.usage_details);
}

// "$0.1765"-style for small sums, "$12.40" once it reaches a dollar
export function formatUsd(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: value < 1 ? 4 : 2 });
}
