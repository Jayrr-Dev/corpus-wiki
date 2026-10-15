"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { dateColumn, statusColumn, textColumn } from "@/app/(app)/_components/columns";
import { Facts } from "@/app/(app)/_components/bits";
import type { Tone } from "@/app/(app)/_lib/tone";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { ChangeIcon } from "@/components/icons";
import type { Tables } from "@/lib/database/types";
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

// "18680" -> "18,680"; a missing count shows as a dash
function formatCount(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US");
}

// A numeric column in mono, sorted by its number
function countColumn<T>(id: string, header: string, value: (row: T) => number | null): ColumnDef<T, unknown> {
  return textColumn<T>(id, header, (row) => String(value(row) ?? 0).padStart(12, "0"), (row) => <span className="font-mono">{formatCount(value(row))}</span>);
}

// COLUMNS: one row per day and model
const TOTAL_COLUMNS: ColumnDef<UsageTotal, unknown>[] = [
  textColumn<UsageTotal>("day", "Day", (total) => total.day, (total) => <span className="font-mono">{total.day}</span>),
  textColumn<UsageTotal>("model", "Model", (total) => total.model),
  countColumn<UsageTotal>("calls", "Calls", (total) => total.calls),
  countColumn<UsageTotal>("prompt", "Tokens in", (total) => total.promptTokens),
  countColumn<UsageTotal>("completion", "Tokens out", (total) => total.completionTokens),
  countColumn<UsageTotal>("reasoning", "of which reasoning", (total) => total.reasoningTokens),
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
  const empty = <EmptyState icon={ChangeIcon} title="No AI calls yet" hint="Every upload and page rebuild is logged here." />;
  return (
    <div className="flex flex-col gap-6">
      <Facts
        items={[
          ["Calls", `${formatCount(total.calls)} (${formatCount(total.failed)} cut off or failed)`],
          ["Tokens in", formatCount(total.promptTokens)],
          ["Tokens out", `${formatCount(total.completionTokens)} (${formatCount(total.reasoningTokens)} reasoning)`],
        ]}
      />
      <DataTable query={{ ...calls, data: totals }} columns={TOTAL_COLUMNS} getRowId={(row) => `${row.day}|${row.model}`} pageSize={7} filterPlaceholder="Search days or models…" emptyState={empty} />
      <DataTable query={calls} columns={CALL_COLUMNS} getRowId={(call) => call.id} pageSize={20} filterPlaceholder="Search calls…" emptyState={empty} />
    </div>
  );
}
