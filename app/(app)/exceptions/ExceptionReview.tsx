"use client";

import { useException } from "@/lib/queries";
import { useRowsByIds } from "@/lib/queries/screens";
import { UNIT_ACTION_TYPES } from "@/app/(app)/_components/ActionSummary";
import { useActionTexts } from "../changes/useActionTexts";
import { ExceptionCard } from "./ExceptionCard";
import type { InboxRow } from "./useExceptionInbox";

// Only the selected item loads its full comparison and revision history.
export function ExceptionReview({ row }: { row: InboxRow }) {
  const latest = useException(row.exception.id);
  const exception = latest.data ?? row.exception;
  const actions = useRowsByIds("actions", [exception.action_id]);
  const action = actions.data?.[0] ?? row.action;
  const units = useRowsByIds("units", action && UNIT_ACTION_TYPES.has(action.type) ? [action.target_id] : []);
  const unit = units.data?.[0];
  const revisions = useRowsByIds("revisions", unit ? [unit.current_revision_id] : []);
  const history = useActionTexts(action ? [action] : []);
  const queries = [latest, actions, units, revisions, ...history.queries];
  const error = queries.find((query) => query.error)?.error;
  if (error) return <div className="p-4" role="alert"><p>Could not load this review: {error.message}</p><button type="button" className="mt-2 text-link underline" onClick={() => void Promise.all(queries.map((query) => query.refetch()))}>Try again</button></div>;
  if (queries.some((query) => query.isPending)) return <p className="p-4 text-muted-foreground" role="status">Loading evidence…</p>;
  if (!latest.data) return <p className="p-4 text-muted-foreground">This exception is no longer available.</p>;
  if (!action) return <p className="p-4 text-muted-foreground">The proposed change could not be found.</p>;
  return <ExceptionCard key={exception.id} exception={exception} action={action}
    unit={unit ? { ...unit, content: revisions.data?.[0]?.content ?? "" } : undefined}
    before={exception.status !== "open" ? history.textsOf(action).before : null} />;
}
