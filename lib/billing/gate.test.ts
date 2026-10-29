import { afterEach, describe, expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import { createUsageGate, type UsageDecision, type UsageGateMode, UsageLimitError, usageGateMode } from "./gate";

// =====================================================================
// THE USAGE GATE without a database: the RPC is a mock. Off never calls
// it, log mode counts but never blocks, enforce mode blocks at a limit.
// =====================================================================

const call = { purpose: "section_lines", model: "zai-org/GLM-5.3-Flash", promptChars: 4_000, maxTokens: 2_000 };

const decision = (over: Partial<UsageDecision> = {}): UsageDecision => ({
  ok: true, reason: null, resetsAt: null, reserved: 2,
  sessionStartsAt: "2026-10-29T08:00:00.000Z", weeklyStartsAt: "2026-10-27T00:00:00.000Z", userId: "user-1", ...over,
});

function gateWith(mode: UsageGateMode, answer: UsageDecision | Error) {
  const rpc = vi.fn<(fn: string, args?: Record<string, unknown>) => Promise<unknown>>(async (fn) => {
    if (fn === "check_and_reserve_usage" && answer instanceof Error) throw answer;
    return fn === "check_and_reserve_usage" ? answer : undefined;
  });
  const db = { call: rpc } as unknown as DbRpc;
  return { rpc, gate: createUsageGate({ db, mode: async () => mode }) };
}

afterEach(() => vi.restoreAllMocks());

describe("usageGateMode", () => {
  it("is off without the billing flag, whatever the monetization switch says", () => {
    expect(usageGateMode(false, false)).toBe("off");
    expect(usageGateMode(false, true)).toBe("off");
  });
  it("only enforces when the monetization switch is on", () => {
    expect(usageGateMode(true, false)).toBe("log");
    expect(usageGateMode(true, true)).toBe("enforce");
  });
});

describe("createUsageGate", () => {
  it("does nothing while billing is off", async () => {
    const { rpc, gate } = gateWith("off", decision());
    const reservation = await gate.reserve(call);
    expect(rpc).not.toHaveBeenCalled();
    // The credits are still worked out for the log
    expect(await reservation.settle({ model: call.model, prompt_tokens: 1_000_000, completion_tokens: 0 })).toBe(150);
  });

  it("never blocks while the monetization switch is off, even past a limit", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { rpc, gate } = gateWith("log", decision({ ok: false, reason: "weekly_limit", resetsAt: "2026-11-03T00:00:00.000Z" }));
    await expect(gate.reserve(call)).resolves.toBeDefined();
    expect(rpc).toHaveBeenCalledWith("check_and_reserve_usage", expect.objectContaining({ p_enforce: false }));
  });

  it("logs the limit it would have hit while only logging", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { gate } = gateWith("log", decision({ reason: "session_limit" }));
    await gate.reserve(call);
    expect(info).toHaveBeenCalledWith(expect.stringContaining("session_limit"));
  });

  it("refuses a call past a limit when enforcing, with the reset time", async () => {
    const { rpc, gate } = gateWith("enforce", decision({ ok: false, reason: "session_limit", resetsAt: "2026-10-29T13:00:00.000Z", reserved: 0 }));
    const error = await gate.reserve(call).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UsageLimitError);
    expect(error).toMatchObject({ reason: "session_limit", resetsAt: "2026-10-29T13:00:00.000Z" });
    expect(rpc).toHaveBeenCalledWith("check_and_reserve_usage", expect.objectContaining({ p_enforce: true, p_user: null }));
  });

  it("reserves a whole-credit estimate from the prompt and the output budget", async () => {
    const { rpc, gate } = gateWith("enforce", decision());
    await gate.reserve(call);
    const args = rpc.mock.calls[0]![1] as { p_credits: number };
    // 1,000 prompt tokens and 2,000 output tokens on GLM-5.3-Flash: $0.00115, so 2 credits
    expect(args.p_credits).toBe(2);
  });

  it("fails open when the database cannot answer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { gate } = gateWith("enforce", new Error("connection lost"));
    await expect(gate.reserve(call)).resolves.toBeDefined();
  });

  it("settles the difference between the estimate and the real cost", async () => {
    const { rpc, gate } = gateWith("enforce", decision({ reserved: 2 }));
    const reservation = await gate.reserve(call);
    // 10,000 prompt tokens and 1,000 output tokens: $0.002, so 2 credits (no change)
    expect(await reservation.settle({ model: call.model, prompt_tokens: 10_000, completion_tokens: 1_000 })).toBe(2);
    expect(rpc).toHaveBeenCalledTimes(1);
    // 1M prompt tokens: 150 credits, 148 more than reserved
    expect(await reservation.settle({ model: call.model, prompt_tokens: 1_000_000, completion_tokens: 0 })).toBe(150);
    expect(rpc).toHaveBeenLastCalledWith("settle_usage", {
      p_user: "user-1", p_session_starts: "2026-10-29T08:00:00.000Z", p_weekly_starts: "2026-10-27T00:00:00.000Z", p_delta: 148,
    });
  });

  it("keeps the estimate when the provider sent no usage", async () => {
    const { rpc, gate } = gateWith("enforce", decision({ reserved: 2 }));
    const reservation = await gate.reserve(call);
    expect(await reservation.settle({ model: call.model, prompt_tokens: null, completion_tokens: null })).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("reads the mode once per interval, not on every call", async () => {
    const mode = vi.fn(async (): Promise<UsageGateMode> => "off");
    let now = 0;
    const gate = createUsageGate({ db: { call: vi.fn() } as unknown as DbRpc, mode, modeTtlMs: 1_000, now: () => now });
    await gate.reserve(call);
    await gate.reserve(call);
    expect(mode).toHaveBeenCalledTimes(1);
    now = 2_000;
    await gate.reserve(call);
    expect(mode).toHaveBeenCalledTimes(2);
  });

  it("treats an unreadable mode as off", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rpc = vi.fn();
    const gate = createUsageGate({ db: { call: rpc } as unknown as DbRpc, mode: async () => { throw new Error("flags down"); } });
    await gate.reserve(call);
    expect(rpc).not.toHaveBeenCalled();
  });
});
