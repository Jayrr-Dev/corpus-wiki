"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { textColumn } from "@/app/(app)/_components/columns";
import { DataTable } from "@/components/data-table";
import { estimateCost, formatUsd, MODEL_PRICES, PRICES_CHECKED_ON, priceFor, type ModelPrice } from "@/lib/ai/pricing";
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
  textColumn<CostRow>("spent", "Est. spent", (row) => (row.spent ?? -1).toFixed(6).padStart(16, "0"), (row) => <span className="font-mono">{row.spent ? formatUsd(row.spent) : "—"}</span>),
];

export function CostTable({ activeModel }: { activeModel: string }) {
  const calls = useAiCalls();
  const activeName = priceFor(activeModel)?.model;
  const rows = useMemo<CostRow[]>(() => {
    const usage = new Map<string, { calls: number; spent: number }>();
    for (const call of calls.data ?? []) {
      const name = priceFor(call.model)?.model;
      if (!name) continue;
      const entry = usage.get(name) ?? { calls: 0, spent: 0 };
      entry.calls += 1;
      entry.spent += estimateCost(call.model, call.prompt_tokens ?? 0, call.completion_tokens ?? 0) ?? 0;
      usage.set(name, entry);
    }
    return MODEL_PRICES.map((price) => ({
      ...price,
      active: price.model === activeName,
      calls: usage.get(price.model)?.calls ?? 0,
      spent: usage.get(price.model)?.spent ?? null,
    }));
  }, [calls.data, activeName]);

  return (
    <div className="flex flex-col gap-4">
      {activeName ? null : (
        <p className="rounded-lg bg-sidebar px-3 py-2.5 text-panel text-muted-foreground">
          The active model <span className="break-all font-mono text-foreground">{activeModel}</span> has no price here, so its calls are left out of cost estimates.
        </p>
      )}
      <DataTable query={{ data: rows, isPending: false, error: calls.error }} columns={COLUMNS} getRowId={(row) => row.model} pageSize={25} filterPlaceholder="Search models…" emptyState={null} />
      <p className="text-xs text-faint">List prices in US dollars, checked {PRICES_CHECKED_ON}. Reasoning tokens bill as output. Estimates only; your Nebius invoice is the source of truth.</p>
    </div>
  );
}
