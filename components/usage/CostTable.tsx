"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { textColumn } from "@/app/(app)/_components/columns";
import { DataTable } from "@/components/data-table";
import { estimateCallCost, formatUsd, MODEL_PRICES, PRICES_CHECKED_ON, priceFor, type ModelPrice } from "@/lib/ai/pricing";
import { useAiCalls } from "@/lib/queries";

// =====================================================================
// COST TABLE: Token Factory list prices per model, with what this
// workspace has spent on each so far. Mounted on /settings.
// =====================================================================

type CostRow = ModelPrice & { active: boolean; calls: number; spent: number | null };

// "$0.15" per 1M tokens
const perMillion = (value: number) => <span className="font-mono">{formatUsd(value)}</span>;

const COLUMNS: ColumnDef<CostRow, unknown>[] = [
  textColumn<CostRow>("model", "Model", (row) => row.model, (row) => (
    <span>
      {row.model}
      {row.active ? <span className="ml-2 rounded-md bg-sidebar px-1.5 py-0.5 text-xs text-muted-foreground">active</span> : null}
    </span>
  )),
  textColumn<CostRow>("input", "Input / 1M", (row) => row.inputPerM.toFixed(4).padStart(10, "0"), (row) => perMillion(row.inputPerM)),
  textColumn<CostRow>("output", "Output / 1M", (row) => row.outputPerM.toFixed(4).padStart(10, "0"), (row) => perMillion(row.outputPerM)),
  textColumn<CostRow>("calls", "Your calls", (row) => String(row.calls).padStart(10, "0"), (row) => <span className="font-mono">{row.calls ? row.calls.toLocaleString("en-US") : "—"}</span>),
  textColumn<CostRow>("spent", "Est. spent", (row) => (row.spent ?? -1).toFixed(6).padStart(16, "0"), (row) => <span className="font-mono">{formatUsd(row.spent)}</span>),
];

export function CostTable({ activeModel }: { activeModel: string }) {
  const calls = useAiCalls();
  const activeName = priceFor(activeModel)?.model;
  const rows = useMemo<CostRow[]>(() => {
    const usage = new Map<string, { calls: number; pricedCalls: number; spent: number }>();
    for (const call of calls.data ?? []) {
      const name = priceFor(call.model)?.model;
      if (!name) continue;
      const entry = usage.get(name) ?? { calls: 0, pricedCalls: 0, spent: 0 };
      entry.calls += 1;
      const cost = estimateCallCost(call);
      entry.spent += cost ?? 0;
      entry.pricedCalls += cost === null ? 0 : 1;
      usage.set(name, entry);
    }
    return MODEL_PRICES.map((price) => ({
      ...price,
      active: price.model === activeName,
      calls: usage.get(price.model)?.calls ?? 0,
      spent: usage.get(price.model)?.pricedCalls ? usage.get(price.model)!.spent : null,
    }));
  }, [calls.data, activeName]);
  const unknownCalls = (calls.data ?? []).filter((call) => estimateCallCost(call) === null).length;

  return (
    <div className="flex flex-col gap-4">
      {activeName ? null : (
        <p className="rounded-lg bg-sidebar px-3 py-2.5 text-panel text-muted-foreground">
          The active model <span className="break-all font-mono text-foreground">{activeModel}</span> has no price here, so its calls are left out of cost estimates.
        </p>
      )}
      <DataTable query={{ data: rows, isPending: false, error: calls.error }} columns={COLUMNS} getRowId={(row) => row.model} pageSize={25} filterPlaceholder="Search models…" emptyState={null} />
      {unknownCalls > 0 && <p className="text-xs text-muted-foreground">{unknownCalls.toLocaleString("en-US")} calls have unknown cost and are excluded from the amounts shown.</p>}
      <p className="text-xs text-faint">Provider list prices in US dollars, checked {PRICES_CHECKED_ON}. Spent covers all-time logged usage in this space. Cache reads and writes use their own rates when recorded. Haiku 5.5 requests over 100,000 input tokens use $0.50 input and $2.50 output per million. Reasoning is included in output. Calls without usage or prices are excluded; older calls may lack cache details. Your provider invoice is the source of truth.</p>
    </div>
  );
}
