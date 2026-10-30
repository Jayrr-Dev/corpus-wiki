import { expect, it } from "vitest";
import { estimateCallCost, estimateCost, priceFor } from "./pricing";
import { usageTokens } from "./callLog";
import { addCompletionUsage } from "./chat";

it("prices Haiku on both sides of the exact 100,000-token boundary", () => {
  expect(estimateCost("anthropic/claude-haiku-5-5", 100_000, 1000)).toBeCloseTo(0.0105);
  expect(estimateCost("anthropic/claude-haiku-5-5", 100_001, 1000)).toBeCloseTo(0.0525005);
});

it("separates regular input, cache reads, five-minute and one-hour writes", () => {
  expect(estimateCost("anthropic/claude-opus-5-5", 10000, 1000, {
    cache_read_input_tokens: 6000, cache_creation_input_tokens: 3000,
    cache_creation: { ephemeral_5m_input_tokens: 2000, ephemeral_1h_input_tokens: 1000 },
  })).toBeCloseTo(0.0432);
  expect(estimateCost("anthropic/claude-sonnet-5-5", 10000, 0, { cache_read_input_tokens: 10000 })).toBeCloseTo(0.001);
  expect(estimateCost("anthropic/claude-fable-5-1", 10000, 0, { cache_read_input_tokens: 10000 })).toBeCloseTo(0.0025);
});

it("counts cached tokens toward the Haiku context tier", () => {
  expect(estimateCost("anthropic/claude-haiku-5-5", 100001, 1000, { cache_read_input_tokens: 100000 })).toBeCloseTo(0.0075005);
});

it("preserves usage through logging and prices tool rounds separately", () => {
  const usage = addCompletionUsage({ prompt_tokens: 60000, completion_tokens: 1000, cache_read_input_tokens: 50000 },
    { prompt_tokens: 60000, completion_tokens: 1000, cache_read_input_tokens: 50000 });
  expect(usageTokens(usage).usageDetails).toEqual(usage);
  expect(estimateCost("anthropic/claude-haiku-5-5", 120000, 2000, usage)).toBeCloseTo(0.004);
});

it("bills Token Factory cached input at its own rate", () => {
  const cached = { prompt_tokens_details: { cached_tokens: 9584 }, prompt_cache_hit_tokens: 9584 };
  expect(estimateCost("nvidia/nemotron-3-super-120b-a12b", 9610, 45, cached)).toBeCloseTo((26 * 0.3 + 9584 * 0.06 + 45 * 0.9) / 1_000_000, 9);
  expect(estimateCost("nvidia/nemotron-3-super-120b-a12b", 9610, 45, { prompt_cache_hit_tokens: 9584 })).toBeCloseTo((26 * 0.3 + 9584 * 0.06 + 45 * 0.9) / 1_000_000, 9);
  expect(estimateCost("nvidia/nemotron-3-super-120b-a12b", 100, 0, { prompt_tokens_details: { cached_tokens: 200 } })).toBeNull();
  expect(estimateCost("zai-org/GLM-5.3", 1_000_000, 0, cached)).toBeCloseTo(1.4);
});

it("prices each tool round's cached input on its own", () => {
  const usage = addCompletionUsage({ prompt_tokens: 1000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } },
    { prompt_tokens: 1000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 1000 } });
  expect(estimateCost("nvidia/nemotron-3-super-120b-a12b", 2000, 0, usage)).toBeCloseTo((1000 * 0.3 + 1000 * 0.06) / 1_000_000, 9);
});

it("prices the dated DeepSeek V4.1 Flash build the Deduplicator runs on", () => {
  expect(estimateCost("deepseek-ai/DeepSeek-V4.1-Flash-1017", 1_000_000, 1_000_000)).toBeCloseTo(1.5);
  expect(estimateCost("deepseek-ai/DeepSeek-V4.1-Flash-1017", 1000, 0, { prompt_tokens_details: { cached_tokens: 1000 } })).toBeCloseTo(0.000006, 9);
});

it("does not show missing usage, unknown pricing or invalid counts as free calls", () => {
  expect(estimateCallCost({ model: "anthropic/claude-haiku-5-5", prompt_tokens: null, completion_tokens: null })).toBeNull();
  expect(estimateCost("Qwen/Qwen3-Embedding-8B", 1_000_000, 0)).toBeCloseTo(0.01);
  expect(estimateCallCost({ model: "Qwen/Qwen3-Embedding-8B", prompt_tokens: null, completion_tokens: 0 })).toBeNull();
  expect(estimateCost("unknown", 100, 200)).toBeNull();
  expect(estimateCost("claude-haiku-5-5", -1, 200)).toBeNull();
  expect(estimateCost("claude-haiku-5-5", 100, 200, { cache_read_input_tokens: 200 })).toBeNull();
  expect(priceFor("openrouter/anthropic/claude-opus-5-5")).toBeNull();
  expect(estimateCost("openrouter/inception/mercury-3", 61_390, 28_331)).toBeCloseTo(0.01605485);
  expect(priceFor("cerebras/gpt-oss-120b")).toBeNull();
  expect(priceFor("anthropic/claude-haiku-4-5-20251001")?.inputPerM).toBe(1);
});
