import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AiCallRecord } from "./callLog";
import { chatJson, CompletionLengthError, type CompletionResponse, oneLeadingSystemMessage, parseContent } from "./chat";
import { CONCISE_OUTPUT_INSTRUCTIONS } from "./outputStyle";

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
    await expect(chatJson({ apiKey: "k", model: "other/model" }, request)).resolves.toMatchObject({ value: { summary: "ok" } });
    expect(efforts).toEqual(["medium", "low"]);
  });

  it("starts at low effort when requested and sends GLM both effort fields", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(completion('{"summary":"ok"}', "stop"))));
    vi.stubGlobal("fetch", fetchMock);
    await chatJson({ apiKey: "k", model: "zai-org/GLM-5.3-Flash" }, { ...request, reasoningEffort: "low" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(JSON.parse(String(init[1].body))).toMatchObject({ reasoning_effort: "low", chat_template_kwargs: { reasoning_effort: "low" } });
  });

  it("rejects a truncated low-effort answer without repeating the same call", async () => {
    const efforts = stubCompletions(completion('{"summary":"ok"}', "length"));
    await expect(chatJson({ apiKey: "k", model: "other/model" }, { ...request, reasoningEffort: "low" })).rejects.toThrow(/ran out of room/);
    expect(efforts).toEqual(["low"]);
  });

  it("does not ask again for any other bad answer", async () => {
    const efforts = stubCompletions(completion("  ", "stop"));
    await expect(chatJson({ apiKey: "k", model: "other/model" }, request)).rejects.toThrow(/returned no answer/);
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

// =====================================================================
// REQUEST OPTIONS AND PROVIDER HANDLING: per-model fields, truncation,
// refusals, throttling and timeouts.
// =====================================================================

const OK_SCHEMA = z.object({ ok: z.boolean() });
const okRequest = { name: "test", schema: OK_SCHEMA, jsonSchema: z.toJSONSchema(OK_SCHEMA), messages: [] };
const okCompletion = (content: string | null, finish_reason = "stop") => new Response(JSON.stringify({
  choices: [{ message: { content }, finish_reason }], usage: { prompt_tokens: 12, completion_tokens: 8 },
}));

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("chatJson request options", () => {
  it("keeps concise guidance out of wiki article requests", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okCompletion('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    const messages = [{ role: "system" as const, content: "Write a complete wiki article." }, { role: "user" as const, content: "Article evidence" }];
    await chatJson({ apiKey: "test" }, { ...okRequest, outputStyle: "wiki_article", messages });
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(sent.messages.slice(1)).toEqual(messages);
  });

  it("adds concise guidance once per retry, preserving custom instructions and media evidence", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(okCompletion(null, "length"))
      .mockResolvedValueOnce(okCompletion('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    const messages = [{ role: "system" as const, content: "Custom role instructions" }, { role: "user" as const, content: [{ type: "text" as const, text: "Describe this evidence" }, { type: "image_url" as const, image_url: { url: "data:image/png;base64,test" } }] }];
    await chatJson({ apiKey: "test", model: "other/model" }, { ...okRequest, messages });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      const sent = JSON.parse(String(call[1]?.body));
      expect(sent.messages.filter((message: { content: unknown }) => message.content === CONCISE_OUTPUT_INSTRUCTIONS)).toHaveLength(1);
      expect(sent.messages.slice(2)).toEqual(messages);
    }
  });

  it.each(["nvidia/nemotron-3-super-120b-a12b", "nvidia/Nemotron-3-Nano-30B-A3B", "nvidia/Nemotron-3-Ultra-550b-a55b"])("disables hidden thinking for %s", async (model) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okCompletion('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    const answer = await chatJson({ apiKey: "test", model }, okRequest);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ chat_template_kwargs: { enable_thinking: false } });
    expect(answer).toMatchObject({ value: { ok: true }, tokensIn: 12, tokensOut: 8 });
  });

  it("sends GLM-5.3-Flash its reasoning effort through the chat template, preserving the JSON output cap", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okCompletion('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    await chatJson({ apiKey: "test", model: "zai-org/GLM-5.3-Flash" }, { ...okRequest, maxTokens: 2000 });
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(sent).toMatchObject({ model: "zai-org/GLM-5.3-Flash", reasoning_effort: "medium", chat_template_kwargs: { reasoning_effort: "medium" }, max_tokens: 2000 });
    expect(sent.chat_template_kwargs).not.toHaveProperty("enable_thinking");
  });

  it("reports the actual response model and requested cap when output is truncated", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({
      model: "zai-org/GLM-5.3-Flash", choices: [{ finish_reason: "length", message: { content: null } }],
    }))));
    await expect(chatJson({ apiKey: "test", model: "alias" }, { ...okRequest, maxTokens: 8000 })).rejects.toThrow("zai-org/GLM-5.3-Flash ran out of room after its tokens (8000 allowed)");
  });

  it("does not send Nemotron-specific options to other models", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okCompletion('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    await chatJson({ apiKey: "test", model: "other/model" }, okRequest);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).not.toHaveProperty("chat_template_kwargs");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ reasoning_effort: "medium" });
  });

  it.each([null, '{"ok":', '{"ok":true}'])("rejects length-limited responses even with parseable content: %s", async (content) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => okCompletion(content, "length")));
    await expect(chatJson({ apiKey: "test" }, okRequest)).rejects.toMatchObject({ name: "CompletionLengthError", tokensIn: 12, tokensOut: 8 });
  });

  it("keeps schema validation for completed answers", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(okCompletion('{"ok":"wrong"}')));
    await expect(chatJson({ apiKey: "test" }, okRequest)).rejects.toThrow("expected shape");
  });

  it("does not treat authentication errors as truncation", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("Unauthorized", { status: 401 })));
    await expect(chatJson({ apiKey: "test" }, okRequest)).rejects.not.toBeInstanceOf(CompletionLengthError);
  });
});

describe("Nebius response handling", () => {
  it("sends a strict schema in both the prompt and response_format", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okCompletion('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    await chatJson({ apiKey: "test" }, { ...okRequest, messages: [{ role: "user", content: "Check this" }] });
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(sent.response_format.json_schema).toMatchObject({ strict: true, schema: okRequest.jsonSchema });
    expect(sent.messages[0]).toEqual({ role: "system", content: `Return only JSON matching this schema: ${JSON.stringify(okRequest.jsonSchema)}` });
    expect(sent.messages[1]).toEqual({ role: "system", content: CONCISE_OUTPUT_INSTRUCTIONS });
    expect(sent.messages[2]).toEqual({ role: "user", content: "Check this" });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports an explicit refusal instead of a missing-answer error", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: null, refusal: "Cannot comply" } }],
    }))));
    await expect(chatJson({ apiKey: "test", model: "model" }, okRequest)).rejects.toThrow("model declined the request: Cannot comply");
  });

  it("honors Retry-After before retrying a throttled request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("Rate limited", { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(okCompletion('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    const pending = chatJson({ apiKey: "test" }, okRequest);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ value: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops after three throttled attempts", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response("Rate limited", { status: 429, headers: { "Retry-After": "0" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatJson({ apiKey: "test" }, okRequest)).rejects.toThrow("429");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports long throttle waits without retrying too early", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("Rate limited", { status: 429, headers: { "Retry-After": "60" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatJson({ apiKey: "test" }, okRequest)).rejects.toThrow("429");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives a clear timeout error without automatically duplicating work", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatJson({ apiKey: "test" }, okRequest)).rejects.toThrow("within three minutes");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// CEREBRAS MESSAGES: Qwen accepts only one system message, and only at the start
describe("oneLeadingSystemMessage", () => {
  it("joins every system message into one at the start and keeps the rest in order", () => {
    expect(oneLeadingSystemMessage([
      { role: "system", content: "a" },
      { role: "user", content: "u1" },
      { role: "system", content: "b" },
      { role: "user", content: "u2" },
    ])).toEqual([{ role: "system", content: "a\n\nb" }, { role: "user", content: "u1" }, { role: "user", content: "u2" }]);
  });
});
