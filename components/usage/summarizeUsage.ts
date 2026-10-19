import type { Tables } from "@/lib/database/types";
import { estimateCallCost } from "@/lib/ai/pricing";
import { roleForPurpose } from "@/lib/ai/roles";

// =====================================================================
// USAGE TOTALS: AI calls folded into one row per day and model, plus the
// grand total. Pure, so the sums are unit-tested.
// =====================================================================

type AiCall = Tables<"ai_calls">;

export type UsageTotal = {
  day: string; // YYYY-MM-DD (UTC)
  model: string;
  calls: number;
  failed: number; // cut off or error
  promptTokens: number;
  completionTokens: number; // includes reasoning
  reasoningTokens: number;
  costUsd: number;
  unknownCostCalls: number;
  legacyClaudeCalls: number;
};

// An empty total for one day and model
const emptyTotal = (day: string, model: string): UsageTotal => ({
  day,
  model,
  calls: 0,
  failed: 0,
  promptTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0,
  costUsd: 0,
  unknownCostCalls: 0,
  legacyClaudeCalls: 0,
});

// Adds one call to a total (a missing count adds nothing)
function addCall(total: UsageTotal, call: AiCall): UsageTotal {
  const cost = estimateCallCost(call);
  return {
    ...total,
    calls: total.calls + 1,
    failed: total.failed + (call.status === "ok" ? 0 : 1),
    promptTokens: total.promptTokens + (call.prompt_tokens ?? 0),
    completionTokens: total.completionTokens + (call.completion_tokens ?? 0),
    reasoningTokens: total.reasoningTokens + (call.reasoning_tokens ?? 0),
    costUsd: total.costUsd + (cost ?? 0),
    unknownCostCalls: total.unknownCostCalls + (cost === null ? 1 : 0),
    legacyClaudeCalls: total.legacyClaudeCalls + (call.model.startsWith("anthropic/") && !call.usage_details ? 1 : 0),
  };
}

// TOTALS BY DAY AND MODEL, newest day first, then by model name
export function totalsByDayAndModel(calls: readonly AiCall[]): UsageTotal[] {
  const totals = new Map<string, UsageTotal>();
  for (const call of calls) {
    const day = call.created_at.slice(0, 10);
    const key = `${day}|${call.model}`;
    totals.set(key, addCall(totals.get(key) ?? emptyTotal(day, call.model), call));
  }
  return [...totals.values()].sort((a, b) => b.day.localeCompare(a.day) || a.model.localeCompare(b.model));
}

// GRAND TOTAL over every call
export function grandTotal(calls: readonly AiCall[]): UsageTotal {
  return calls.reduce(addCall, emptyTotal("all", "all"));
}

// THE ROLE A CALL WAS MADE FOR: the logged role, else the one its purpose maps to ("other" when neither)
export const callRole = (call: AiCall): string => call.role ?? roleForPurpose(call.purpose) ?? "other";

export type RoleTotal = UsageTotal & { role: string };

// TOTALS BY ROLE, most expensive first (ties by call count, then role id)
export function totalsByRole(calls: readonly AiCall[]): RoleTotal[] {
  const totals = new Map<string, RoleTotal>();
  for (const call of calls) {
    const role = callRole(call);
    totals.set(role, { ...addCall(totals.get(role) ?? { ...emptyTotal("all", "all"), role }, call), role });
  }
  return [...totals.values()].sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls || a.role.localeCompare(b.role));
}
