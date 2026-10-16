"use client";
import { useMemo } from "react";
import { readsState } from "@/app/(app)/_lib/reads";
import { useActionTexts } from "@/app/(app)/changes/useActionTexts";
import type { Tables } from "@/lib/database/types";
import { useExceptions } from "@/lib/queries";
import { type UnitSummary, useRowsByIds, useUnitSummaries } from "@/lib/queries/screens";
import type { ListOptions } from "@/lib/queries/fetchers";
export { ExceptionInbox as ExceptionsScreen } from "./ExceptionInbox";

type ExceptionData = {
  exceptions: Tables<"exceptions">[];
  actionById: Map<string, Tables<"actions">>;
  unitById: Map<string, UnitSummary>;
  textsOf: ReturnType<typeof useActionTexts>["textsOf"];
  state: { isPending: boolean; error: Error | null };
};

// Exceptions with the action each holds, the unit that action targets, and the text an applied action replaced
export function useExceptionData(options: ListOptions<"exceptions"> = {}): ExceptionData {
  const exceptions = useExceptions(options);
  const actions = useRowsByIds("actions", (exceptions.data ?? []).map((exception) => exception.action_id));
  const units = useUnitSummaries((actions.data ?? []).map((action) => action.target_id));
  const { textsOf } = useActionTexts(actions.data ?? []);
  const actionById = useMemo(() => new Map((actions.data ?? []).map((action) => [action.id, action])), [actions.data]);
  const unitById = useMemo(() => new Map((units.data ?? []).map((unit) => [unit.id, unit])), [units.data]);
  return { exceptions: exceptions.data ?? [], actionById, unitById, textsOf, state: readsState([exceptions, actions, units]) };
}
