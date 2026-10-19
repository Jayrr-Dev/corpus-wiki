import { afterEach, expect, it, vi } from "vitest";
import { nameDuplicateJudge } from "./nameDuplicateJudge";

afterEach(() => vi.unstubAllGlobals());

it("corrects an overlong explanation without dropping identity validation or usage", async () => {
  const bodies: { messages: { content: string }[] }[] = [];
  vi.stubGlobal("fetch", async (_url: unknown, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return Response.json({ choices: [{ message: { content: JSON.stringify({ duplicateOf: null, reason: bodies.length === 1 ? "x".repeat(301) : "The evidence does not establish the same identity." }) }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 8 } });
  });
  const usage = vi.fn();
  const judge = nameDuplicateJudge({ apiKey: "test", model: "other/model" }, "entity", {}, usage);
  expect(await judge({ name: "Type One" }, [{ name: "Type Two" }])).toBeNull();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]?.messages.at(-1)?.content).toContain("300");
  expect(usage).toHaveBeenCalledWith(expect.objectContaining({ tokensIn: 24, tokensOut: 16 }));
});

it("stops after one corrective retry when a candidate index is still invalid", async () => {
  const fetch = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ duplicateOf: 8, reason: "Same name." }) }, finish_reason: "stop" }] }));
  vi.stubGlobal("fetch", fetch);
  const usage = vi.fn();
  const judge = nameDuplicateJudge({ apiKey: "test", model: "other/model" }, "entity", {}, usage);
  await expect(judge({ name: "Type One" }, [{ name: "Type Two" }])).rejects.toThrow("invalid claim fields");
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(usage).not.toHaveBeenCalled();
});
