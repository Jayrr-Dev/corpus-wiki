import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { chatJson, CompletionLengthError } from "./chat";

const schema = z.object({ ok: z.boolean() });
const request = { name: "test", schema, jsonSchema: z.toJSONSchema(schema), messages: [] };
const completion = (content: string | null, finish_reason = "stop") => new Response(JSON.stringify({
  choices: [{ message: { content }, finish_reason }], usage: { prompt_tokens: 12, completion_tokens: 8 },
}));

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("chatJson", () => {
  it.each(["nvidia/nemotron-3-super-120b-a12b", "nvidia/Nemotron-3-Nano-30B-A3B", "nvidia/Nemotron-3-Ultra-550b-a55b"])("disables hidden thinking for %s", async (model) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(completion('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    const answer = await chatJson({ apiKey: "test", model }, request);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ chat_template_kwargs: { enable_thinking: false } });
    expect(answer).toMatchObject({ value: { ok: true }, tokensIn: 12, tokensOut: 8 });
  });

  it("uses low reasoning effort for the selected GLM-5.3-Flash model, preserving the JSON output cap", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(completion('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    await chatJson({ apiKey: "test", model: "zai-org/GLM-5.3-Flash" }, { ...request, maxTokens: 2000 });
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(sent).toMatchObject({ model: "zai-org/GLM-5.3-Flash", reasoning_effort: "low", chat_template_kwargs: { reasoning_effort: "low" }, max_tokens: 2000 });
    expect(sent.chat_template_kwargs).not.toHaveProperty("enable_thinking");
  });

  it("reports the actual response model and requested cap when output is truncated", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      model: "zai-org/GLM-5.3-Flash", choices: [{ finish_reason: "length", message: { content: null } }],
    }))));
    await expect(chatJson({ apiKey: "test", model: "alias" }, { ...request, maxTokens: 8000 })).rejects.toThrow("zai-org/GLM-5.3-Flash reached its output limit (8000 tokens requested)");
  });

  it("does not send Nemotron-specific options to other models", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(completion('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    await chatJson({ apiKey: "test", model: "other/model" }, request);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).not.toHaveProperty("chat_template_kwargs");
  });

  it.each([null, '{"ok":', '{"ok":true}'])("rejects length-limited responses even with parseable content: %s", async (content) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(completion(content, "length")));
    await expect(chatJson({ apiKey: "test" }, request)).rejects.toMatchObject({ name: "CompletionLengthError", tokensIn: 12, tokensOut: 8 });
  });

  it("keeps schema validation for completed answers", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(completion('{"ok":"wrong"}')));
    await expect(chatJson({ apiKey: "test" }, request)).rejects.toThrow("expected shape");
  });

  it("does not treat authentication errors as truncation", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("Unauthorized", { status: 401 })));
    await expect(chatJson({ apiKey: "test" }, request)).rejects.not.toBeInstanceOf(CompletionLengthError);
  });
});

describe("Nebius response handling", () => {
  it("sends a strict schema in both the prompt and response_format", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(completion('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    await chatJson({ apiKey: "test" }, { ...request, messages: [{ role: "user", content: "Check this" }] });
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(sent.response_format.json_schema).toMatchObject({ strict: true, schema: request.jsonSchema });
    expect(sent.messages[0]).toEqual({ role: "system", content: `Return only JSON matching this schema: ${JSON.stringify(request.jsonSchema)}` });
    expect(sent.messages[1]).toEqual({ role: "user", content: "Check this" });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports an explicit refusal instead of a missing-answer error", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: null, refusal: "Cannot comply" } }],
    }))));
    await expect(chatJson({ apiKey: "test", model: "model" }, request)).rejects.toThrow("model declined the request: Cannot comply");
  });

  it("honors Retry-After before retrying a throttled request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("Rate limited", { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(completion('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    const pending = chatJson({ apiKey: "test" }, request);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ value: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops after three throttled attempts", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response("Rate limited", { status: 429, headers: { "Retry-After": "0" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatJson({ apiKey: "test" }, request)).rejects.toThrow("429");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports long throttle waits without retrying too early", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("Rate limited", { status: 429, headers: { "Retry-After": "60" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatJson({ apiKey: "test" }, request)).rejects.toThrow("429");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives a clear timeout error without automatically duplicating work", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatJson({ apiKey: "test" }, request)).rejects.toThrow("within two minutes");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
