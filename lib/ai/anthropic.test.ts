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
  await requestClaudeCompletion({ apiKey: "test", model: "anthropic/test", messages: [], jsonSchema, maxTokens: 100, effort: "low" });
  const sent = stream.mock.calls[0]![0].output_config.format.schema;
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
