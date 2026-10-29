"use client";

import { type CSSProperties, useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { formatCount } from "@/app/(app)/_lib/format";
import { InfoPopover } from "@/components/standard/info-popover";
import { Button } from "@/components/ui/button";
import type { Tables } from "@/lib/database/types";
import { formatUsd } from "@/lib/ai/pricing";
import { roleName } from "@/lib/ai/roles";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { fetchAllAiCalls } from "./allAiCalls";
import { formatDaySpan, type DayRange } from "./heatmapCells";
import { SpendHeatmap } from "./SpendHeatmap";
import { callsInRange, totalsByDay, totalsByRole, type RoleTotal } from "./summarizeUsage";

// =====================================================================
// ROLE SPEND: what each AI role has cost, most expensive first, so you
// can see which roles to tune. Mounted on /roles.
// =====================================================================

type Calls = UseQueryResult<Tables<"ai_calls">[]>;

// Every logged call (no cap), shared by the panel, the role cards and Settings. Keyed under
// ["table", "ai_calls"] so a saved action refreshes it like the shared list hooks.
export const useAllAiCalls = () => useQuery({ queryKey: ["table", "ai_calls", "all"], queryFn: () => fetchAllAiCalls(getBrowserSupabase()) });

// Spend per role id, for the role cards
export function useRoleSpend(calls: { data?: readonly Tables<"ai_calls">[] | null }): Map<string, RoleTotal> {
  return useMemo(() => new Map(totalsByRole(calls.data ?? []).map((total) => [total.role, total])), [calls.data]);
}

const pct = (part: number, whole: number) => whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";

export function RoleSpendPanel({ calls, range, onRangeChange }: { calls: Calls; range: DayRange | null; onRangeChange: (range: DayRange | null) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const byDay = useMemo(() => totalsByDay(calls.data ?? []), [calls.data]);
  const totals = useMemo(() => totalsByRole(callsInRange(calls.data ?? [], range)), [calls.data, range]);
  const spent = totals.reduce((sum, total) => sum + total.costUsd, 0);
  const top = totals[0]?.costUsd ?? 0;
  const unknown = totals.reduce((sum, total) => sum + total.unknownCostCalls, 0);
  return <section aria-label="Spend by role" className="rounded-xl border bg-sidebar/50 p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-medium">Spend by role</h3>
          <InfoPopover label="About spend by role">
            <p>Estimated spend for each role, from logged calls in this space.</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>Same list prices as Usage in Settings.</li>
              <li>One square is one UTC day. Darker means more spend.</li>
              <li>A second click includes the days between. Click the only chosen day again for every day.</li>
              <li>Roles that only guide the Reconciler are billed to the Reconciler.</li>
            </ul>
          </InfoPopover>
        </div>
        <p className="text-panel text-muted-foreground">{range === null ? "Click a day to filter the prices." : formatDaySpan(range, today)}</p>
      </div>
      <div className="flex items-center gap-2">
        {range !== null ? <Button type="button" variant="ghost" size="xs" onClick={() => onRangeChange(null)}>All time</Button> : null}
        <p className="text-panel text-muted-foreground">{calls.isPending ? "Loading…" : <>This space <span className="font-mono text-foreground">{formatUsd(spent)}</span></>}</p>
      </div>
    </div>
    {calls.error ? <p role="alert" className="mt-3 text-panel text-failed">Could not load AI calls: {calls.error.message}</p>
      : calls.isPending ? null
      : byDay.length === 0 ? <p className="mt-3 text-panel text-faint">No AI calls yet.</p>
      : <>
        <SpendHeatmap totals={byDay} range={range} today={today} onRangeChange={onRangeChange} />
        {totals.length === 0 ? <p className="mt-3 text-panel text-faint">No spend on those days.</p>
          : <ol className="mt-3 space-y-1.5">
        {totals.map((total) => <li key={total.role} className="grid grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)_auto] items-center gap-3 text-panel">
          <span className="truncate">{total.role === "other" ? "Other" : roleName(total.role)}</span>
          <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
            <span className="block h-full w-(--share) rounded-full bg-foreground/70" style={{ "--share": top > 0 ? `${(total.costUsd / top) * 100}%` : "0%" } as CSSProperties} />
          </span>
          <span className="flex justify-end gap-3 font-mono text-xs tabular-nums">
            <span className="w-20 text-right text-foreground">{formatUsd(total.costUsd)}</span>
            <span className="w-9 text-right text-muted-foreground">{pct(total.costUsd, spent)}</span>
            <span className="hidden w-24 text-right text-faint sm:inline">{formatCount(total.calls)} calls</span>
          </span>
        </li>)}
      </ol>}
      </>}
    {unknown > 0 ? <p className="mt-3 text-xs text-faint">{formatCount(unknown)} calls have no price or usage, so totals are partial.</p> : null}
  </section>;
}
