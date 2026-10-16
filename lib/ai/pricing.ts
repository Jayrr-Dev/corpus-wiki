// =====================================================================
// AI PRICING: Token Factory list prices in US dollars per 1M tokens, used
// to estimate what the logged AI calls cost. Reasoning tokens bill as
// output. Prices change: update this table when Nebius changes theirs.
// Source: Nebius Token Factory pricing, checked 2026-10-15; Claude rows: Anthropic API list prices, checked 2026-10-16.
// =====================================================================

export const PRICES_CHECKED_ON = "2026-10-15";

export type ModelPrice = { model: string; inputPerM: number; outputPerM: number };

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
  // Claude ("anthropic/<id>" picks); cache reads bill lower, so cached calls are overestimated
  { model: "claude-fable-5-1", inputPerM: 10.0, outputPerM: 50.0 },
  { model: "claude-opus-5-5", inputPerM: 4.0, outputPerM: 20.0 },
  { model: "claude-opus-5", inputPerM: 5.0, outputPerM: 25.0 },
  { model: "claude-opus-4-8", inputPerM: 5.0, outputPerM: 25.0 },
  { model: "claude-sonnet-5-5", inputPerM: 2.0, outputPerM: 10.0 },
  { model: "claude-sonnet-5", inputPerM: 2.0, outputPerM: 10.0 },
  { model: "claude-haiku-5-5", inputPerM: 0.1, outputPerM: 0.5 },
];

const BY_NAME = new Map(MODEL_PRICES.map((price) => [price.model.toLowerCase(), price]));

// The price for a model id, or null when the table has none
export function priceFor(model: string): ModelPrice | null {
  const name = model.split("/").pop() ?? model;
  return BY_NAME.get(name.toLowerCase()) ?? null;
}

// Estimated dollars for some tokens on one model (null = unpriced model)
export function estimateCost(model: string, promptTokens: number, completionTokens: number): number | null {
  const price = priceFor(model);
  if (!price) return null;
  return (promptTokens * price.inputPerM + completionTokens * price.outputPerM) / 1_000_000;
}

// "$0.1765"-style for small sums, "$12.40" once it reaches a dollar
export function formatUsd(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: value < 1 ? 4 : 2 });
}
