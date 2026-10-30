import { expect, it, vi } from "vitest";
import { z } from "zod";

const { stream } = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class {
  messages = { stream };
} }));

import { requestClaudeCompletion } from "./anthropic";

it("sends Claude-compatible nested schemas without changing local validation", async () => {
  stream.mockReturnValue({ on: vi.fn(), finalMessage: async () => ({ content: [{ type: "text", text: '{"items":[]}' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "end_turn" }) });
  const schema = z.object({ items: z.array(z.object({ text: z.string().max(50) })).max(12) });
  const jsonSchema = z.toJSONSchema(schema);
  const original = structuredClone(jsonSchema);
  await requestClaudeCompletion({ apiKey: "test", model: "anthropic/test", messages: [{ role: "system", content: "Shared extraction instructions" }], jsonSchema, maxTokens: 100, effort: "low" });
  const sent = stream.mock.calls[0]![0].output_config.format.schema;
  expect(stream.mock.calls[0]![0].system).toEqual([{ type: "text", text: "Shared extraction instructions", cache_control: { type: "ephemeral" } }]);
  expect(stream.mock.calls[0]![0].output_config.format).not.toHaveProperty("parse");
  expect(sent.properties.items.maxItems).toBeUndefined();
  expect(sent.properties.items.description).toContain("maxItems: 12");
  expect(sent.properties.items.items.properties.text.maxLength).toBeUndefined();
  expect(jsonSchema).toEqual(original);
  expect(schema.safeParse({ items: Array.from({ length: 13 }, () => ({ text: "ok" })) }).success).toBe(false);
});

it("returns cut-off structured output for the shared length retry", async () => {
  stream.mockReturnValue({ on: vi.fn(), finalMessage: async () => ({ content: [{ type: "text", text: '{"items":["unfinished' }], usage: { input_tokens: 12, output_tokens: 100 }, stop_reason: "max_tokens" }) });
  const result = await requestClaudeCompletion({ apiKey: "test", model: "anthropic/test", messages: [], jsonSchema: { type: "object" }, maxTokens: 100, effort: "low" });
  expect(result.choices?.[0]?.finish_reason).toBe("length");
  expect(result.choices?.[0]?.message?.content).toBe('{"items":["unfinished');
  expect(result.usage?.completion_tokens).toBe(100);
});

it("retains cache usage and write duration in the billable response", async () => {
  stream.mockReturnValue({ on: vi.fn(), finalMessage: async () => ({ content: [{ type: "text", text: "{}" }],
    usage: { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 6000,
      cache_creation_input_tokens: 3000, cache_creation: { ephemeral_5m_input_tokens: 2000, ephemeral_1h_input_tokens: 1000 } }, stop_reason: "end_turn" }) });
  const result = await requestClaudeCompletion({ apiKey: "test", model: "anthropic/claude-opus-5-5", messages: [], jsonSchema: { type: "object" }, maxTokens: 100, effort: "low" });
  expect(result.usage).toMatchObject({ prompt_tokens: 10000, completion_tokens: 50, cache_read_input_tokens: 6000,
    cache_creation_input_tokens: 3000, cache_creation: { ephemeral_5m_input_tokens: 2000, ephemeral_1h_input_tokens: 1000 } });
});

it("preserves supported nested enum and const constraints in the provider schema", async () => {
  stream.mockReturnValue({ on: vi.fn(), finalMessage: async () => ({ content: [{ type: "text", text: '{"claims":[]}' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "end_turn" }) });
  const jsonSchema = z.toJSONSchema(z.object({ claims: z.array(z.object({
    epistemicStatus: z.enum(["established", "supported", "hypothesis"]),
    kind: z.literal("fact"),
    optional: z.enum(["all", "any"]).nullable(),
  })) }));
  const original = structuredClone(jsonSchema);
  await requestClaudeCompletion({ apiKey: "test", model: "anthropic/test", messages: [], jsonSchema, maxTokens: 100, effort: "low" });
  const sent = stream.mock.calls.at(-1)![0].output_config.format.schema.properties.claims.items.properties;
  expect(sent.epistemicStatus.enum).toEqual(["established", "supported", "hypothesis"]);
  expect(sent.kind.const).toBe("fact");
  expect(sent.optional.anyOf[0].enum).toEqual(["all", "any"]);
  expect(jsonSchema).toEqual(original);
});

it("ends the cached prefix after a user message marked cache, leaving the rest uncached", async () => {
  stream.mockReturnValue({ on: vi.fn(), finalMessage: async () => ({ content: [{ type: "text", text: "{}" }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "end_turn" }) });
  await requestClaudeCompletion({ apiKey: "test", model: "anthropic/test", jsonSchema: { type: "object" }, maxTokens: 100, effort: "low",
    messages: [{ role: "system", content: "Rules" }, { role: "user", content: "Shared book context", cache: true }, { role: "user", content: "This batch" }] });
  expect(stream.mock.calls.at(-1)![0].messages).toEqual([
    { role: "user", content: [{ type: "text", text: "Shared book context", cache_control: { type: "ephemeral" } }] },
    { role: "user", content: "This batch" },
  ]);
});
