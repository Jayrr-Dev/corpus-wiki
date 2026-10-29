import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { DbRpc } from "@/lib/db/rpc";
import { createUsageGate, type UsageGateMode, UsageLimitError } from "@/lib/billing/gate";
import type { AiCallRecord } from "./callLog";
import { chatJson } from "./chat";

// =====================================================================
// THE GATE IN chatJson: one reservation before each attempt, settled after.
// While the monetization switch is off a call past the limit still runs;
// with it on, the call never reaches the provider. The provider and the
// database are mocks.
// =====================================================================

const SCHEMA = z.object({ summary: z.string() });
const request = { name: "section_lines", schema: SCHEMA, jsonSchema: {}, messages: [{ role: "user" as const, content: "x".repeat(4_000) }] };

function provider() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    model: "zai-org/GLM-5.3-Flash",
    choices: [{ message: { content: '{"summary":"ok"}' }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1_000_000, completion_tokens: 0 },
  })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function gate(mode: UsageGateMode, ok: boolean) {
  const rpc = vi.fn(async (fn: string) => fn === "check_and_reserve_usage"
    ? { ok, reason: ok ? null : "weekly_limit", resetsAt: "2026-11-03T00:00:00.000Z", reserved: ok ? 5 : 0, sessionStartsAt: "s", weeklyStartsAt: "w", userId: "user-1" }
    : undefined);
  return { rpc, usageGate: createUsageGate({ db: { call: rpc } as unknown as DbRpc, mode: async () => mode }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chatJson behind the usage gate", () => {
  it("runs the call past a limit while the monetization switch is off, and logs its credits", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchMock = provider();
    const { rpc, usageGate } = gate("log", false);
    const calls: AiCallRecord[] = [];
    const answer = await chatJson({ apiKey: "k", model: "zai-org/GLM-5.3-Flash", usageGate, logCall: async (call) => void calls.push(call) }, request);
    expect(answer.value).toEqual({ summary: "ok" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("check_and_reserve_usage", expect.objectContaining({ p_enforce: false }));
    // 1M prompt tokens on GLM-5.3-Flash: $0.15
    expect(calls).toMatchObject([{ purpose: "section_lines", credits: 150 }]);
  });

  it("stops the call before the provider when enforcing at a limit", async () => {
    const fetchMock = provider();
    const { usageGate } = gate("enforce", false);
    await expect(chatJson({ apiKey: "k", model: "zai-org/GLM-5.3-Flash", usageGate }, request)).rejects.toBeInstanceOf(UsageLimitError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("settles the real cost after an allowed call", async () => {
    provider();
    const { rpc, usageGate } = gate("enforce", true);
    await chatJson({ apiKey: "k", model: "zai-org/GLM-5.3-Flash", usageGate }, request);
    expect(rpc).toHaveBeenLastCalledWith("settle_usage", { p_user: "user-1", p_session_starts: "s", p_weekly_starts: "w", p_delta: 145 });
  });

  it("logs credits without any gate", async () => {
    provider();
    const calls: AiCallRecord[] = [];
    await chatJson({ apiKey: "k", model: "zai-org/GLM-5.3-Flash", logCall: async (call) => void calls.push(call) }, request);
    expect(calls[0]?.credits).toBe(150);
  });
});
