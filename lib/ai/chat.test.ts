import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AiCallRecord } from "./callLog";
import { type ChatTool, chatJson, CompletionLengthError, type CompletionResponse, oneLeadingSystemMessage, parseContent, settingsForCall, throttleWaitSeconds, tokenFactoryFromEnv } from "./chat";
import { CONCISE_OUTPUT_INSTRUCTIONS } from "./outputStyle";
import { forgetCachedMemory, openRoleMemory, saveRoleMemory } from "./memory";
import { MODEL_ROLES } from "./roles";

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

  it("regenerates an invalid extraction once with enum feedback and counts both attempts", async () => {
    const schema = z.object({ epistemicStatus: z.enum(["supported", "unknown"]) });
    const bodies: { messages: { content: string }[] }[] = [];
    vi.stubGlobal("fetch", async (_url: URL, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify(completion(JSON.stringify({ epistemicStatus: bodies.length === 1 ? "fact" : "supported" }), "stop")));
    });
    const answer = await chatJson({ apiKey: "k", model: "other/model" }, { ...request, schema, jsonSchema: z.toJSONSchema(schema), retryInvalidOutput: true });
    expect(answer).toMatchObject({ value: { epistemicStatus: "supported" }, tokensIn: 37360, tokensOut: 200 });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]?.messages.at(-1)?.content).toContain("supported");
    expect(bodies[1]?.messages.at(-1)?.content).toContain("epistemicStatus");
  });

  it("stops after one corrective retry and never coerces invalid fields", async () => {
    const efforts = stubCompletions(completion('{"summary":42}', "stop"), completion('{"summary":42}', "stop"));
    await expect(chatJson({ apiKey: "k", model: "other/model" }, { ...request, retryInvalidOutput: true })).rejects.toThrow("invalid claim fields");
    expect(efforts).toHaveLength(2);
  });

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
    await expect(chatJson({ apiKey: "test" }, okRequest)).rejects.toThrow("invalid claim fields");
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

  it("asks once more after a stall, and gives up after a second one", async () => {
    vi.useFakeTimers();
    // A request that never answers until it is aborted
    const stall = (_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) =>
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
    const fetchMock = vi.fn<typeof fetch>().mockImplementationOnce(stall).mockResolvedValueOnce(okCompletion('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    const pending = chatJson({ apiKey: "test" }, okRequest);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(pending).resolves.toMatchObject({ value: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const always = vi.fn<typeof fetch>().mockImplementation(stall);
    vi.stubGlobal("fetch", always);
    const stuck = chatJson({ apiKey: "test" }, okRequest);
    const failed = expect(stuck).rejects.toThrow("no new output for 60 seconds");
    await vi.advanceTimersByTimeAsync(120_000);
    await failed;
    expect(always).toHaveBeenCalledTimes(2);
  });

  it("moves to a backup straight after a stall instead of waiting out a second one", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "router-key");
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((url, init) => String(url).startsWith("https://openrouter.ai")
      ? Promise.resolve(okCompletion('{"ok":true}'))
      : new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true })));
    vi.stubGlobal("fetch", fetchMock);
    const pending = chatJson({ apiKey: "test", backups: [{ model: "openrouter/inception/mercury-3", costPerM: null, tokensPerSecond: null, intelligence: null }] }, okRequest);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(pending).resolves.toMatchObject({ value: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("moves to a backup provider when the picked one keeps failing, but not for a bad request", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "router-key");
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).startsWith("https://openrouter.ai")
      ? okCompletion('{"ok":true}') : new Response("Payment required", { status: 402 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatJson({ apiKey: "test", backups: [{ model: "openrouter/inception/mercury-3", costPerM: null, tokensPerSecond: null, intelligence: null }] }, okRequest)).resolves.toMatchObject({ value: { ok: true } });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/^https:\/\/openrouter\.ai/);

    const badRequest = vi.fn<typeof fetch>().mockResolvedValue(new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", badRequest);
    await expect(chatJson({ apiKey: "test", backups: [{ model: "openrouter/inception/mercury-3", costPerM: null, tokensPerSecond: null, intelligence: null }] }, okRequest)).rejects.toThrow("400");
    expect(badRequest).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it("waits out an overloaded provider (529) like a throttled one", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"error":{"message":"worker overloaded"}}', { status: 529 }))
      .mockResolvedValueOnce(okCompletion('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    const pending = chatJson({ apiKey: "test" }, okRequest);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ value: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops after five throttled attempts", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response("Rate limited", { status: 429, headers: { "Retry-After": "0" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatJson({ apiKey: "test" }, okRequest)).rejects.toThrow("429");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("waits out a per-minute token quota that gives no Retry-After (Cerebras)", async () => {
    vi.useFakeTimers();
    const quota = () => new Response('{"code":"token_quota_exceeded"}', { status: 429 });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(quota()).mockResolvedValueOnce(quota()).mockResolvedValueOnce(okCompletion('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    const pending = chatJson({ apiKey: "test" }, okRequest);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1 + 15000);
    await expect(pending).resolves.toMatchObject({ value: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses the provider's per-minute reset when it sends one", () => {
    expect(throttleWaitSeconds(new Headers({ "x-ratelimit-reset-tokens-minute": "41.2" }), 0)).toBe(42);
    expect(throttleWaitSeconds(new Headers({ "Retry-After": "3", "x-ratelimit-reset-tokens-minute": "41" }), 0)).toBe(3);
    expect(throttleWaitSeconds(new Headers(), 9)).toBe(60);
  });

  it("reports long throttle waits without retrying too early", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("Rate limited", { status: 429, headers: { "Retry-After": "120" } }));
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

describe("model by role", () => {
  const env = { NEBIUS_API_KEY: "nebius", CEREBRAS_API_KEY: "cerebras" } as unknown as NodeJS.ProcessEnv;
  const settings = tokenFactoryFromEnv(env, { model: "base/model", roleModels: { write_articles: "cerebras/fast", reviewer: "smart/model" } })!;

  it("sends a role's calls to its own model and provider", () => {
    expect(settingsForCall(settings, "section_lines")).toMatchObject({ apiKey: "cerebras", model: "cerebras/fast", baseUrl: expect.stringContaining("cerebras") });
    expect(settingsForCall(settings, "page_editorial_review")).toMatchObject({ apiKey: "nebius", model: "smart/model", baseUrl: undefined });
  });

  it("keeps the workspace model for other roles and unnamed calls", () => {
    expect(settingsForCall(settings, "reconciliation").model).toBe("base/model");
    expect(settingsForCall(settings, "place_topics").model).toBe("base/model");
  });

  it("accepts a plain model id as before", () => {
    expect(tokenFactoryFromEnv(env, "base/model")).toEqual({ apiKey: "nebius", model: "base/model", logCall: undefined });
  });
});

describe("role memory", () => {
  // The in-process copies are shared by every call; each test starts without them
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const role of MODEL_ROLES) forgetCachedMemory(role);
  });

  // A fake database port holding one role's saved notes, recording what was written
  const memoryDb = (saved: { key: string; value: string }[]) => {
    const writes: Record<string, unknown>[] = [];
    return {
      writes,
      call: async <T,>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
        if (fn === "get_role_memory") return saved.map((entry) => ({ ...entry, source: null, updatedAt: "", expiresAt: null })) as T;
        writes.push({ fn, ...args });
        return 1 as T;
      },
    };
  };
  const rounds = (...replies: CompletionResponse[]) => {
    let round = 0;
    const fetchMock = vi.fn<(url: URL, init: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(replies[round++])));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  const sent = (fetchMock: ReturnType<typeof rounds>, round: number) => JSON.parse(String(fetchMock.mock.calls[round]![1].body));

  it("puts the role's notes in the system message and answers in one strict request, with no tools", async () => {
    const fetchMock = rounds(completion('{"summary":"ok"}', "stop"));
    const db = memoryDb([{ key: "pref:tone", value: "zebra-crossing" }]);
    const result = await chatJson({ apiKey: "k", model: "other/model", memoryDb: db }, { name: "section_lines", schema: SCHEMA, jsonSchema: {}, messages: [] });
    expect(result.value).toEqual({ summary: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = sent(fetchMock, 0);
    expect(body.tools).toBeUndefined();
    expect(body.response_format).toMatchObject({ type: "json_schema" });
    expect(JSON.stringify(body.messages)).toContain("pref:tone: zebra-crossing");
    expect(db.writes).toEqual([]);
  });

  it("adds nothing when the role has no notes", async () => {
    const fetchMock = rounds(completion('{"summary":"ok"}', "stop"));
    await chatJson({ apiKey: "k", model: "other/model", memoryDb: memoryDb([]) }, { name: "section_lines", schema: SCHEMA, jsonSchema: {}, messages: [] });
    expect(JSON.stringify(sent(fetchMock, 0).messages)).not.toContain("Your notes");
  });

  it("shows run notes to the role's next call", async () => {
    const db = memoryDb([]);
    const memory = (await openRoleMemory(db, "dedupe"))!;
    await saveRoleMemory(memory, [{ key: "dedupe:seen", value: "c1,c2", scope: "run", ttlHours: 0 }], [], "dedupe");
    const next = rounds(completion('{"summary":"b"}', "stop"));
    await chatJson({ apiKey: "k", model: "other/model", memoryDb: db }, { name: "duplicate_judge", schema: SCHEMA, jsonSchema: {}, messages: [] });
    expect(JSON.stringify(sent(next, 0).messages)).toContain("dedupe:seen: c1,c2");
    expect(db.writes).toEqual([]);
  });

  it("gives independent reviewers and unnamed calls no memory", async () => {
    for (const name of ["independent_article_review", "independent_external_source_approval", "independent_upload_domain_review", "unassigned_test_call"]) {
      const fetchMock = rounds(completion('{"summary":"ok"}', "stop"));
      await chatJson({ apiKey: "k", model: "other/model", memoryDb: memoryDb([{ key: "pref:x", value: "y" }]) }, { name, schema: SCHEMA, jsonSchema: {}, messages: [] });
      expect(JSON.stringify(sent(fetchMock, 0).messages)).not.toContain("pref:x");
    }
  });

  it("gives topic placement its assigned domain-decider memory", async () => {
    const fetchMock = rounds(completion('{"summary":"ok"}', "stop"));
    await chatJson({ apiKey: "k", model: "other/model", memoryDb: memoryDb([{ key: "filing:preference", value: "Reuse existing topics" }]) }, { name: "place_topics", schema: SCHEMA, jsonSchema: {}, messages: [] });
    expect(JSON.stringify(sent(fetchMock, 0).messages)).toContain("filing:preference");
  });
});

describe("tool calls", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Answers each round with the next reply: tool calls, or the final JSON
  const toolCall = (id: string, name: string, args: unknown): CompletionResponse => ({
    choices: [{ message: { content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }],
    usage: { prompt_tokens: 100, completion_tokens: 10 },
  });
  const rounds = (...replies: CompletionResponse[]) => {
    let round = 0;
    const fetchMock = vi.fn<(url: URL, init: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(replies[round++])));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  const sent = (fetchMock: ReturnType<typeof rounds>, round: number) => JSON.parse(String(fetchMock.mock.calls[round]![1].body));
  // A lookup tool a request supplies itself; it fails on an empty key
  const lookup = (seen: unknown[] = []): ChatTool => ({
    name: "lookup", description: "Look a key up.", parameters: { type: "object", properties: { key: { type: "string" } } },
    run: async (args) => {
      seen.push(args);
      if (!(args as { key?: string }).key) throw new Error("key is required");
      return { value: "plain" };
    },
  });
  const ask = (tools: ChatTool[]) => chatJson({ apiKey: "k", model: "other/model" }, { name: "section_lines", schema: SCHEMA, jsonSchema: {}, messages: [], tools });

  it("runs the tools the model calls, sends the results back, and sums the usage", async () => {
    const seen: unknown[] = [];
    const fetchMock = rounds(toolCall("c1", "lookup", { key: "pref:tone" }), toolCall("c2", "lookup", { key: "cache:page" }), completion('{"summary":"done"}', "stop"));
    const result = await ask([lookup(seen)]);
    expect(result).toMatchObject({ value: { summary: "done" }, tokensIn: 100 + 100 + 18_680, tokensOut: 10 + 10 + 100 });
    const second = sent(fetchMock, 1).messages;
    expect(second.at(-2)).toMatchObject({ role: "assistant", tool_calls: [{ id: "c1" }] });
    expect(second.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c1" });
    expect(JSON.parse(second.at(-1).content)).toEqual({ value: "plain" });
    expect(seen).toEqual([{ key: "pref:tone" }, { key: "cache:page" }]);
  });

  it("returns a tool's error to the model instead of failing the call", async () => {
    const fetchMock = rounds(toolCall("c1", "lookup", { key: "" }), completion('{"summary":"ok"}', "stop"));
    await expect(ask([lookup()])).resolves.toMatchObject({ value: { summary: "ok" } });
    expect(JSON.parse(sent(fetchMock, 1).messages.at(-1).content)).toHaveProperty("error");
  });

  it("answers without tools when the provider rejects them", async () => {
    const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => JSON.parse(String(init.body)).tools
      ? new Response("tools are not supported for this model", { status: 400 })
      : new Response(JSON.stringify(completion('{"summary":"ok"}', "stop"))));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(ask([lookup()])).resolves.toMatchObject({ value: { summary: "ok" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops offering tools after the last tool round", async () => {
    const calls = Array.from({ length: 4 }, (_, index) => toolCall(`c${index}`, "lookup", { key: "k" }));
    const fetchMock = rounds(...calls, completion('{"summary":"ok"}', "stop"));
    await ask([lookup()]);
    expect(sent(fetchMock, 4).tool_choice).toBe("none");
  });

  it("offers tools without the strict response format, and asks once more with it when the answer misses the schema", async () => {
    const fetchMock = rounds(completion("Sure, here is a summary.", "stop"), completion('{"summary":"ok"}', "stop"));
    const result = await ask([lookup()]);
    expect(result.value).toEqual({ summary: "ok" });
    expect(sent(fetchMock, 0).response_format).toBeUndefined();
    expect(sent(fetchMock, 1)).toMatchObject({ response_format: { type: "json_schema" } });
    expect(sent(fetchMock, 1).tools).toBeUndefined();
  });

  it("accepts an unconstrained answer that already matches the schema", async () => {
    const fetchMock = rounds(completion('{"summary":"ok"}', "stop"));
    await ask([lookup()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
