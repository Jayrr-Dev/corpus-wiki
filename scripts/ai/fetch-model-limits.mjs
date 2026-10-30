// FETCH MODEL LIMITS: downloads every provider's published limits into
// lib/ai/modelLimits.json, which chat.ts reads to set max_tokens.
//
// contextTokens    total room for one call, input and output together
// maxOutputTokens  the most one answer may write, when the provider publishes it
// tokensPerMinute  the account's rate limit for the model, when published
//
// scripts/ai/nebius-catalog.tsv fills in Nebius models the API does not list. It is
// the Token Factory catalog page, name and limit in thousands of tokens, so its
// values are rounded; a value from the API always wins. A model on two limits keeps the lower.
//
// RUN when models change: node --env-file=.env.local scripts/ai/fetch-model-limits.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const OUTPUT = join(ROOT, "lib", "ai", "modelLimits.json");
const CATALOG = join(ROOT, "scripts", "ai", "nebius-catalog.tsv");

// "deepseek-ai/DeepSeek-V4.1-Flash-1017" -> "deepseek-v4.1-flash-1017"
const bareName = (id) => id.slice(id.lastIndexOf("/") + 1).toLowerCase();

async function list(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return (await response.json()).data ?? [];
}

const PROVIDERS = {
  nebius: async (env) => {
    const models = await list("https://api.tokenfactory.nebius.com/v1/models?verbose=true", { Authorization: `Bearer ${env.NEBIUS_API_KEY}` });
    const limits = {};
    for (const line of readFileSync(CATALOG, "utf8").split("\n")) {
      const [name, thousands] = line.trim().split("\t");
      if (name && thousands) limits[bareName(name)] = { contextTokens: Number(thousands) * 1000, source: "catalog" };
    }
    for (const model of models) {
      if (model.context_length) limits[bareName(model.id)] = { contextTokens: model.context_length, tokensPerMinute: model.per_request_limits?.tokens_per_minute, source: "api" };
    }
    return limits;
  },
  openrouter: async (env) => Object.fromEntries((await list("https://openrouter.ai/api/v1/models", { Authorization: `Bearer ${env.OPENROUTER_KEY ?? env.OPENROUTER_API_KEY}` }))
    .filter((model) => model.context_length)
    .map((model) => [model.id.toLowerCase(), { contextTokens: model.top_provider?.context_length ?? model.context_length, maxOutputTokens: model.top_provider?.max_completion_tokens ?? undefined, source: "api" }])),
  anthropic: async (env) => Object.fromEntries((await list("https://api.anthropic.com/v1/models?limit=100", { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }))
    .map((model) => [model.id.toLowerCase(), { contextTokens: model.max_input_tokens + model.max_tokens, maxInputTokens: model.max_input_tokens, maxOutputTokens: model.max_tokens, source: "api" }])),
  mistral: async (env) => Object.fromEntries((await list("https://api.mistral.ai/v1/models", { Authorization: `Bearer ${env.MISTRAL_API_KEY}` }))
    .filter((model) => model.max_context_length)
    .map((model) => [model.id.toLowerCase(), { contextTokens: model.max_context_length, source: "api" }])),
};

const providers = {};
for (const [name, read] of Object.entries(PROVIDERS)) {
  providers[name] = Object.fromEntries(Object.entries(await read(process.env)).sort(([a], [b]) => a.localeCompare(b)));
  console.log(`${name}: ${Object.keys(providers[name]).length} models`);
}
writeFileSync(OUTPUT, `${JSON.stringify({ fetchedOn: new Date().toISOString().slice(0, 10), providers }, null, 1)}\n`);
