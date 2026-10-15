"use client";

import { useMemo, useState } from "react";
import { UNIT_ACTION_TYPES } from "@/app/(app)/_components/ActionSummary";
import { QueryState, Section } from "@/app/(app)/_components/bits";
import { readsState } from "@/app/(app)/_lib/reads";
import { EmptyState } from "@/components/EmptyState";
import { ExceptionIcon } from "@/components/icons";
import { useActionTexts } from "@/app/(app)/changes/useActionTexts";
import type { Tables } from "@/lib/database/types";
import { useExceptions } from "@/lib/queries";
import { type UnitSummary, useRowsByIds, useUnitSummaries } from "@/lib/queries/screens";
import { cn } from "@/lib/utils";
import { CATEGORY_TABS, type CategoryTab, inTab } from "./categories";
import { ExceptionCard } from "./ExceptionCard";

// EXCEPTIONS SCREEN: category tabs, then open questions first and the answered ones below
export function ExceptionsScreen() {
  const { exceptions, actionById, unitById, textsOf, state } = useExceptionData();
  const [tab, setTab] = useState<CategoryTab>("all");
  const shown = exceptions.filter((exception) => inTab(tab, exception.reason));
  const open = shown.filter((exception) => exception.status === "open");
  const answered = shown.filter((exception) => exception.status !== "open");
  const renderCard = (exception: Tables<"exceptions">) => {
    const action = actionById.get(exception.action_id);
    const unit = action && UNIT_ACTION_TYPES.has(action.type) ? unitById.get(action.target_id ?? "") : undefined;
    // Once applied, the unit already reads as the proposal; compare against the text it replaced
    const before = action && exception.status !== "open" ? textsOf(action).before : null;
    return <ExceptionCard key={exception.id} exception={exception} action={action} unit={unit} before={before} />;
  };
  return (
    <QueryState query={state}>
      <div className="flex flex-col gap-6">
        <CategoryTabs exceptions={exceptions} tab={tab} onChange={setTab} />
        <Section title={`Open (${open.length})`}>
          {open.length === 0 ? <EmptyState icon={ExceptionIcon} title="Nothing needs you here" /> : <div className="flex flex-col gap-4">{open.map(renderCard)}</div>}
        </Section>
        {answered.length > 0 ? (
          <Section title={`Answered (${answered.length})`}>
            <div className="flex flex-col gap-4">{answered.map(renderCard)}</div>
          </Section>
        ) : null}
      </div>
    </QueryState>
  );
}

// CATEGORY TABS: one per category that has exceptions, each with its open count
function CategoryTabs({ exceptions, tab, onChange }: { exceptions: Tables<"exceptions">[]; tab: CategoryTab; onChange: (tab: CategoryTab) => void }) {
  const tabs = CATEGORY_TABS.filter((item) => item.id === "all" || item.id === tab || exceptions.some((exception) => inTab(item.id, exception.reason)));
  return (
    <div role="tablist" aria-label="Exception categories" className="-mb-2 flex gap-1 overflow-x-auto overflow-y-hidden border-b">
      {tabs.map((item) => {
        const openCount = exceptions.filter((exception) => exception.status === "open" && inTab(item.id, exception.reason)).length;
        const selected = item.id === tab;
        return (

            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(item.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-panel transition-colors",
                selected ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
              {openCount > 0 ? <span className="rounded-sm bg-hover px-1.5 font-mono text-xs text-muted-foreground">{openCount}</span> : null}
            </button>

        );
      })}
    </div>
  );
}

type ExceptionData = {
  exceptions: Tables<"exceptions">[];
  actionById: Map<string, Tables<"actions">>;
  unitById: Map<string, UnitSummary>;
  textsOf: ReturnType<typeof useActionTexts>["textsOf"];
  state: { isPending: boolean; error: Error | null };
};

// Exceptions with the action each holds, the unit that action targets, and the text an applied action replaced
function useExceptionData(): ExceptionData {
  const exceptions = useExceptions();
  const actions = useRowsByIds("actions", (exceptions.data ?? []).map((exception) => exception.action_id));
  const units = useUnitSummaries((actions.data ?? []).map((action) => action.target_id));
  const { textsOf } = useActionTexts(actions.data ?? []);
  const actionById = useMemo(() => new Map((actions.data ?? []).map((action) => [action.id, action])), [actions.data]);
  const unitById = useMemo(() => new Map((units.data ?? []).map((unit) => [unit.id, unit])), [units.data]);
  return { exceptions: exceptions.data ?? [], actionById, unitById, textsOf, state: readsState([exceptions, actions, units]) };
}
