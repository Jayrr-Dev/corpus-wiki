"use client";

import { useMemo } from "react";
import { UNIT_ACTION_TYPES } from "@/app/(app)/_components/ActionSummary";
import { QueryState, Section } from "@/app/(app)/_components/bits";
import { readsState } from "@/app/(app)/_lib/reads";
import { EmptyState } from "@/components/EmptyState";
import { ExceptionIcon } from "@/components/icons";
import type { Tables } from "@/lib/database/types";
import { useExceptions } from "@/lib/queries";
import { type UnitSummary, useRowsByIds, useUnitSummaries } from "@/lib/queries/screens";
import { ExceptionCard } from "./ExceptionCard";

// EXCEPTIONS SCREEN: open questions first, then the answered ones
export function ExceptionsScreen() {
  const { exceptions, actionById, unitById, state } = useExceptionData();
  const open = exceptions.filter((exception) => exception.status === "open");
  const answered = exceptions.filter((exception) => exception.status !== "open");
  const renderCard = (exception: Tables<"exceptions">) => {
    const action = actionById.get(exception.action_id);
    const unit = action && UNIT_ACTION_TYPES.has(action.type) ? unitById.get(action.target_id ?? "") : undefined;
    return <ExceptionCard key={exception.id} exception={exception} action={action} unit={unit} />;
  };
  return (
    <QueryState query={state}>
      <div className="flex flex-col gap-6">
        <Section title={`Open (${open.length})`}>
          {open.length === 0 ? <EmptyState icon={ExceptionIcon} title="Nothing needs you" /> : open.map(renderCard)}
        </Section>
        {answered.length > 0 ? <Section title={`Answered (${answered.length})`}>{answered.map(renderCard)}</Section> : null}
      </div>
    </QueryState>
  );
}

type ExceptionData = {
  exceptions: Tables<"exceptions">[];
  actionById: Map<string, Tables<"actions">>;
  unitById: Map<string, UnitSummary>;
  state: { isPending: boolean; error: Error | null };
};

// Exceptions with the action each holds and the unit that action targets
function useExceptionData(): ExceptionData {
  const exceptions = useExceptions();
  const actions = useRowsByIds("actions", (exceptions.data ?? []).map((exception) => exception.action_id));
  const units = useUnitSummaries((actions.data ?? []).map((action) => action.target_id));
  const actionById = useMemo(() => new Map((actions.data ?? []).map((action) => [action.id, action])), [actions.data]);
  const unitById = useMemo(() => new Map((units.data ?? []).map((unit) => [unit.id, unit])), [units.data]);
  return { exceptions: exceptions.data ?? [], actionById, unitById, state: readsState([exceptions, actions, units]) };
}
