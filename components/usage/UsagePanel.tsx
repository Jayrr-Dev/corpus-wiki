"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { countColumn, dateColumn, statusColumn, textColumn } from "@/app/(app)/_components/columns";
import { formatCount } from "@/app/(app)/_lib/format";
import type { Tone } from "@/app/(app)/_lib/tone";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { ChangeIcon } from "@/components/icons";
import type { Tables } from "@/lib/database/types";
import { estimateCost, formatUsd } from "@/lib/ai/pricing";
import { useAiCalls } from "@/lib/queries";
import { grandTotal, totalsByDayAndModel, type UsageTotal } from "./summarizeUsage";

// =====================================================================
// USAGE PANEL: what the AI calls cost. The grand total, totals per day
// and model, then every call (searchable). Mounted on /settings.
// =====================================================================

type AiCall = Tables<"ai_calls">;
type CallStatus = "ok" | "cut_off" | "error";

// STATUS TONES: a cut-off answer was retried, an error failed the call
const CALL_TONE: Record<CallStatus, Tone> = { ok: "applied", cut_off: "needs-you", error: "failed" };

// A dollar column in mono, sorted by its amount (unpriced sorts lowest)
function costColumn<T>(id: string, header: string, value: (row: T) => number | null): ColumnDef<T, unknown> {
  return textColumn<T>(id, header, (row) => (value(row) ?? -1).toFixed(6).padStart(16, "0"), (row) => <span className="font-mono">{formatUsd(value(row))}</span>);
}

const totalCost = (total: UsageTotal) => estimateCost(total.model, total.promptTokens, total.completionTokens);
const callCost = (call: AiCall) => estimateCost(call.model, call.prompt_tokens ?? 0, call.completion_tokens ?? 0);

// COLUMNS: one row per day and model
const TOTAL_COLUMNS: ColumnDef<UsageTotal, unknown>[] = [
  textColumn<UsageTotal>("day", "Day", (total) => total.day, (total) => <span className="font-mono">{total.day}</span>),
  textColumn<UsageTotal>("model", "Model", (total) => total.model),
  countColumn<UsageTotal>("calls", "Calls", (total) => total.calls),
  countColumn<UsageTotal>("prompt", "Tokens in", (total) => total.promptTokens),
  countColumn<UsageTotal>("completion", "Tokens out", (total) => total.completionTokens),
  countColumn<UsageTotal>("reasoning", "of which reasoning", (total) => total.reasoningTokens),
  costColumn<UsageTotal>("cost", "Est. cost", totalCost),
];

// COLUMNS: one row per call
const CALL_COLUMNS: ColumnDef<AiCall, unknown>[] = [
  dateColumn<AiCall>("created", "When", (call) => call.created_at, true),
  statusColumn<AiCall, CallStatus>("Status", (call) => toStatus(call.status), CALL_TONE),
  textColumn<AiCall>("purpose", "For", (call) => `${call.purpose} ${call.subject ?? ""}`, (call) => (
    <span className="whitespace-normal">
      {call.purpose.replaceAll("_", " ")}
      {call.subject ? <span className="text-faint"> · {call.subject}</span> : null}
    </span>
  )),
  textColumn<AiCall>("model", "Model", (call) => `${call.model} ${call.reasoning_effort ?? ""}`, (call) => (
    <span>
      {call.model}
      {call.reasoning_effort ? <span className="text-faint"> · {call.reasoning_effort}</span> : null}
    </span>
  )),
  countColumn<AiCall>("prompt", "In", (call) => call.prompt_tokens),
  countColumn<AiCall>("completion", "Out", (call) => call.completion_tokens),
  countColumn<AiCall>("reasoning", "Reasoning", (call) => call.reasoning_tokens),
  costColumn<AiCall>("cost", "Est. cost", callCost),
  countColumn<AiCall>("duration", "Seconds", (call) => Math.round(call.duration_ms / 1000)),
];

// The stored status as a known one (anything else reads as an error)
function toStatus(status: string): CallStatus {
  return status === "ok" || status === "cut_off" ? status : "error";
}

// USAGE PANEL
export function UsagePanel() {
  const calls = useAiCalls();
  const totals = useMemo(() => totalsByDayAndModel(calls.data ?? []), [calls.data]);
  const total = useMemo(() => grandTotal(calls.data ?? []), [calls.data]);
  const cost = useMemo(() => {
    const priced = totals.map(totalCost);
    return { usd: priced.reduce<number>((sum, value) => sum + (value ?? 0), 0), unpriced: new Set(totals.filter((_, i) => priced[i] === null).map((t) => t.model)).size };
  }, [totals]);
  const empty = <EmptyState icon={ChangeIcon} title="No AI calls yet" hint="Every upload and page rebuild is logged here." />;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total calls", value: total.calls, detail: `${formatCount(total.failed)} cut off or failed` },
          { label: "Tokens in", value: total.promptTokens, detail: "Input tokens processed" },
          { label: "Tokens out", value: total.completionTokens, detail: `${formatCount(total.reasoningTokens)} reasoning tokens` },
          { label: "Estimated cost", value: cost.usd, detail: cost.unpriced ? `${cost.unpriced} model${cost.unpriced === 1 ? "" : "s"} without a price` : "At Token Factory list prices", usd: true },
        ].map(({ label, value, detail, usd }) => (
          <div key={label} className="min-w-0 rounded-xl border bg-sidebar/50 p-4">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-2 break-all text-2xl font-semibold tracking-tight tabular-nums">{calls.isPending ? "—" : usd ? formatUsd(value) : formatCount(value)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
          </div>
        ))}
      </div>
      <h3 className="font-medium">Daily breakdown</h3>
      <DataTable query={{ ...calls, data: totals }} columns={TOTAL_COLUMNS} getRowId={(row) => `${row.day}|${row.model}`} pageSize={7} filterPlaceholder="Search days or models…" emptyState={empty} />
      <h3 className="font-medium">Recent calls</h3>
      <DataTable query={calls} columns={CALL_COLUMNS} getRowId={(call) => call.id} pageSize={20} filterPlaceholder="Search calls…" emptyState={empty} />
    </div>
  );
}

