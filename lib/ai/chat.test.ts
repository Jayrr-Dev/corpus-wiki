import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AiCallRecord } from "./callLog";
import { chatJson, type CompletionResponse, parseContent } from "./chat";

// =====================================================================
// PARSING THE MODEL'S ANSWER: every unusable answer gets a clear message.
// The first case is the real failure on a 169-passage PDF: GLM-5.3-Flash
// spent the whole 8,000-token budget reasoning and wrote no JSON.
// =====================================================================

const SCHEMA = z.object({ summary: z.string() });

// A completion with one choice
const completion = (content: string | null, finishReason: string, completionTokens = 100): CompletionResponse => ({
  choices: [{ message: { content }, finish_reason: finishReason }],
  usage: { prompt_tokens: 18_680, completion_tokens: completionTokens },
});

describe("parseContent", () => {
  it("says the model ran out of room when the budget ends the answer", () => {
    expect(() => parseContent(completion("", "length", 8000), SCHEMA)).toThrow(/ran out of room after 8000 tokens/);
    expect(() => parseContent(completion('{"summary": "Rea', "length", 8000), SCHEMA)).toThrow(/ran out of room/);
  });

  it("names an empty answer and a broken one instead of a bare JSON error", () => {
    expect(() => parseContent(completion("  ", "stop"), SCHEMA)).toThrow(/returned no answer/);
    expect(() => parseContent(completion('{"summary": "Rea', "stop"), SCHEMA)).toThrow(/not valid JSON/);
  });

  it("returns a valid answer", () => {
    expect(parseContent(completion('{"summary": "Read the safety program"}', "stop"), SCHEMA)).toEqual({ summary: "Read the safety program" });
  });
});

describe("chatJson", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Answers each call with the next completion and records the reasoning effort it asked for
  const stubCompletions = (...completions: CompletionResponse[]) => {
    const efforts: string[] = [];
    vi.stubGlobal("fetch", async (_url: URL, init: { body: string }) => {
      efforts.push(JSON.parse(init.body).reasoning_effort);
      return new Response(JSON.stringify(completions[efforts.length - 1]), { status: 200 });
    });
    return efforts;
  };
  const request = { name: "t", schema: SCHEMA, jsonSchema: {}, messages: [] };

  it("asks again at low effort when the answer is cut off", async () => {
    const efforts = stubCompletions(completion("", "length", 32_000), completion('{"summary": "ok"}', "stop"));
    await expect(chatJson({ apiKey: "k" }, request)).resolves.toMatchObject({ value: { summary: "ok" } });
    expect(efforts).toEqual(["medium", "low"]);
  });

  it("does not ask again for any other bad answer", async () => {
    const efforts = stubCompletions(completion("  ", "stop"));
    await expect(chatJson({ apiKey: "k" }, request)).rejects.toThrow(/returned no answer/);
    expect(efforts).toEqual(["medium"]);
  });

  it("logs every attempt with its token usage, cut-off ones included", async () => {
    stubCompletions(
      { ...completion("", "length", 32_000), usage: { prompt_tokens: 18_680, completion_tokens: 32_000, completion_tokens_details: { reasoning_tokens: 32_000 } } },
      completion('{"summary": "ok"}', "stop", 1960),
    );
    const calls: AiCallRecord[] = [];
    const logCall = async (call: AiCallRecord) => void calls.push(call);
    await chatJson({ apiKey: "k", model: "zai-org/GLM-5.3-Flash", logCall }, { ...request, subject: "safety.pdf" });
    expect(calls).toMatchObject([
      { purpose: "t", subject: "safety.pdf", model: "zai-org/GLM-5.3-Flash", reasoningEffort: "medium", promptTokens: 18_680, completionTokens: 32_000, reasoningTokens: 32_000, status: "cut_off" },
      { purpose: "t", subject: "safety.pdf", model: "zai-org/GLM-5.3-Flash", reasoningEffort: "low", promptTokens: 18_680, completionTokens: 1960, reasoningTokens: null, status: "ok" },
    ]);
  });

  it("never fails the call because logging failed", async () => {
    stubCompletions(completion('{"summary": "ok"}', "stop"));
    const logCall = async () => {
      throw new Error("db down");
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(chatJson({ apiKey: "k", logCall }, request)).resolves.toMatchObject({ value: { summary: "ok" } });
  });
});
