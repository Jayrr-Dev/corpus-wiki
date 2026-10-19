import { describe, expect, it } from "vitest";
import type { Tables } from "@/lib/database/types";
import { grandTotal, totalsByDayAndModel, totalsByRole } from "./summarizeUsage";

// FIXTURE: one call with only the fields the totals read varying
const call = (created_at: string, model: string, status: string, prompt: number | null, completion: number | null, reasoning: number | null): Tables<"ai_calls"> => ({
  id: created_at + model,
  created_at,
  model,
  status,
  prompt_tokens: prompt,
  completion_tokens: completion,
  reasoning_tokens: reasoning,
  purpose: "reconciliation",
  subject: null,
  reasoning_effort: "medium",
  duration_ms: 1000,
  error: null,
});

const CALLS = [
  call("2026-10-14T22:00:00Z", "glm", "cut_off", 18_680, 32_000, 32_000),
  call("2026-10-14T22:03:00Z", "glm", "ok", 18_680, 1960, null),
  call("2026-10-14T22:05:00Z", "nemotron", "ok", 20_620, 4319, 1769),
  call("2026-10-15T09:00:00Z", "glm", "error", null, null, null),
];

describe("usage totals", () => {
  it("sums tokens per day and model, newest day first", () => {
    expect(totalsByDayAndModel(CALLS).map((total) => ({ day: total.day, model: total.model, calls: total.calls,
      failed: total.failed, promptTokens: total.promptTokens, completionTokens: total.completionTokens, reasoningTokens: total.reasoningTokens }))).toEqual([
      { day: "2026-10-15", model: "glm", calls: 1, failed: 1, promptTokens: 0, completionTokens: 0, reasoningTokens: 0 },
      { day: "2026-10-14", model: "glm", calls: 2, failed: 1, promptTokens: 37_360, completionTokens: 33_960, reasoningTokens: 32_000 },
      { day: "2026-10-14", model: "nemotron", calls: 1, failed: 0, promptTokens: 20_620, completionTokens: 4319, reasoningTokens: 1769 },
    ]);
  });

  it("sums every call", () => {
    expect(grandTotal(CALLS)).toMatchObject({ calls: 4, failed: 2, promptTokens: 57_980, completionTokens: 38_279 });
  });

  it("sums request prices without applying Haiku's context tier to a day's combined tokens", () => {
    const model = "anthropic/claude-haiku-5-5";
    const calls = [call("2026-10-18T01:00:00Z", model, "cut_off", 60_000, 1000, 900),
      call("2026-10-18T02:00:00Z", model, "ok", 60_000, 1000, 900),
      call("2026-10-18T03:00:00Z", model, "ok", 100_001, 1000, 900),
      call("2026-10-18T04:00:00Z", model, "error", null, null, null)];
    const total = grandTotal(calls);
    expect(total.costUsd).toBeCloseTo(0.0655005);
    expect(total.unknownCostCalls).toBe(1);
    expect(total.legacyClaudeCalls).toBe(4);
    expect(totalsByDayAndModel(calls)[0]?.costUsd).toBe(total.costUsd);
  });

  it("sums cost per role, most expensive first, falling back to the purpose's role", () => {
    const model = "anthropic/claude-haiku-5-5";
    const calls = [
      { ...call("2026-10-18T01:00:00Z", model, "ok", 10_000, 1000, null), role: "reviewer" },
      { ...call("2026-10-18T02:00:00Z", model, "ok", 50_000, 2000, null), purpose: "section_lines" },
      { ...call("2026-10-18T03:00:00Z", model, "ok", 50_000, 2000, null), role: "write_articles" },
      { ...call("2026-10-18T04:00:00Z", model, "error", null, null, null), purpose: "mystery" },
    ];
    const totals = totalsByRole(calls);
    expect(totals.map((total) => [total.role, total.calls])).toEqual([["write_articles", 2], ["reviewer", 1], ["other", 1]]);
    expect(totals[0]?.costUsd).toBeGreaterThan(totals[1]?.costUsd ?? Infinity);
    expect(totals[2]).toMatchObject({ costUsd: 0, unknownCostCalls: 1 });
    expect(totals.reduce((sum, total) => sum + total.costUsd, 0)).toBeCloseTo(grandTotal(calls).costUsd);
  });
});
