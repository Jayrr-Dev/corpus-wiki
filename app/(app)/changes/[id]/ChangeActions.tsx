"use client";

import { ActionSummary } from "@/app/(app)/_components/ActionSummary";
import { Note, QueryState, Section } from "@/app/(app)/_components/bits";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { type CheckResult, readCheckResults } from "@/app/(app)/_lib/format";
import { readsState } from "@/app/(app)/_lib/reads";
import { DiffView } from "@/components/diff/DiffView";
import type { Tables } from "@/lib/database/types";
import { useActions } from "@/lib/queries";
import { useActionTexts } from "../useActionTexts";

// ACTIONS: every action of the set in position order, with checks and the text it changed
export function ChangeActions({ changeSetId }: { changeSetId: string }) {
  const actions = useActions({ filters: { change_set_id: changeSetId } });
  const list = actions.data ?? [];
  const { queries, textsOf } = useActionTexts(list);
  return (
    <Section title={`Actions (${list.length})`}>
      <QueryState query={readsState([actions, ...queries])}>
        {list.length === 0 ? <Note>No actions.</Note> : null}
        <ol className="flex flex-col divide-y">
          {list.map((action) => (
            <ActionItem key={action.id} action={action} {...textsOf(action)} />
          ))}
        </ol>
      </QueryState>
    </Section>
  );
}

type ActionItemProps = { action: Tables<"actions">; before: string | null; after: string | null };

// ONE ACTION: summary, check results, and a before/after diff when it wrote a revision
function ActionItem({ action, before, after }: ActionItemProps) {
  const hasDiff = before !== null || after !== null;
  return (
    <li className="flex flex-col gap-2 py-3">
      <ActionSummary action={action} />
      <CheckList checks={readCheckResults(action.check_results)} />
      {hasDiff ? <DiffView before={before} after={after} /> : null}
    </li>
  );
}

// CHECKS: one line each, a green or red dot for passed or failed
function CheckList({ checks }: { checks: CheckResult[] }) {
  if (checks.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-panel">
      {checks.map((check, index) => (
        <li key={`${check.name}-${index}`} className="flex items-start gap-2">
          <StatusDot tone={check.passed ? "applied" : "failed"} className="mt-1.5" />
          <span className="font-mono text-xs">{check.name}</span>
          {check.detail ? <span className="text-muted-foreground">{check.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}
