"use client";

import { ActionSummary } from "@/app/(app)/_components/ActionSummary";
import { Note, QueryState, Section } from "@/app/(app)/_components/bits";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { asObject, readString, readStrings, type CheckResult, readCheckResults } from "@/app/(app)/_lib/format";
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
      {action.type === "source_review" || action.type === "source_lifecycle" ? <SourceAuditDetails action={action} /> : null}
      <CheckList checks={readCheckResults(action.check_results)} />
      {hasDiff ? <DiffView before={before} after={after} /> : null}
    </li>
  );
}

function SourceAuditDetails({ action }: { action: Tables<"actions"> }) {
  const input = asObject(action.input);
  const context = asObject(input.context);
  const proposal = asObject(input.proposal);
  const research = asObject(proposal.research);
  const justification = readString(proposal, "justification") ?? readString(research, "justification");
  const facts = readStrings(context, "projectFacts");
  const excerpts = readStrings(input, "excerpts");
  return <div className="space-y-2 text-panel">
    <p className="text-muted-foreground">{[readString(context, "organization"), readString(context, "article"), readString(context, "section")].filter(Boolean).join(" → ")}</p>
    {justification && <p><strong>Researcher’s justification: </strong>{justification}</p>}
    {readString(input, "url") && <a className="text-link hover:underline" href={readString(input, "url")!} target="_blank" rel="noreferrer">View source</a>}
    {facts.length > 0 && <details><summary className="cursor-pointer">Project evidence provided to the approver</summary><ul className="mt-2 list-disc space-y-1 pl-5">{facts.map((fact, i) => <li key={i}>{fact}</li>)}</ul></details>}
    {excerpts.length > 0 && <details><summary className="cursor-pointer">Reviewed excerpts</summary>{excerpts.map((text, i) => <blockquote className="mt-2 border-l-2 pl-3" key={i}>{text}</blockquote>)}</details>}
    <p className="text-muted-foreground">Undo preserves this record and adds a reversal to Changes.{action.type === "source_review" ? " Revoking a source approval also archives its source. Reversing a rejection does not automatically import it." : " The source returns to its previous archive state."}</p>
  </div>;
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
