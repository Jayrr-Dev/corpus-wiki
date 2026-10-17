"use client";

import { useMemo, useState } from "react";
import { TextLink } from "@/app/(app)/_components/bits";
import { dateColumn, textColumn } from "@/app/(app)/_components/columns";
import { formatTokens, statusLabel } from "@/app/(app)/_lib/format";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import type { Tone } from "@/app/(app)/_lib/tone";
import { useActorLabel } from "@/app/(app)/_lib/useActorLabel";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/EmptyState";
import { DecisionIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/standard/tooltip";
import { estimateCost, formatUsd } from "@/lib/ai/pricing";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useActions, useChangeContexts, useChangeSets } from "@/lib/queries";
import { CHANGE_TYPE_LABEL, describeChange, EMPTY_CONTEXT } from "../changes/describeChange";
import { useExceptionData } from "../exceptions/ExceptionsScreen";
import { ExceptionDialog } from "../exceptions/ExceptionDialog";
import { decisionOutcome, jsonObject, roleLabel, roleForAction } from "./describeDecision";
import { UNIT_ACTION_TYPES } from "../_components/ActionSummary";
import { menuColumn, RowMenu } from "@/components/row-menu/RowMenu";
import { DialogForm } from "@/components/actions/DialogForm";
import { useServerAction } from "@/components/actions/useServerAction";
import { undoChangeSet } from "@/lib/server-actions/knowledge";
import type { Tables } from "@/lib/database/types";

type DecisionRow = {
  id: string; type: string; status: string; summary: string; proposer: string; decider: string; decision: string;
  created_at: string; tokens: string; exceptionId?: string; href?: string;
  changeSet?: Tables<"change_sets">;
};

const DECISION_TONE: Record<string, Tone> = {
  Approved: "applied",
  Rejected: "failed",
  Archived: "stale",
  Restored: "applied",
  Pending: "needs-you",
  Error: "failed",
  Reverted: "faint",
  Reinstated: "applied",
};

export function DecisionsTable() {
  const changes = useChangeSets();
  const reviews = useActions({ filters: { type: "source_review" } });
  const archives = useActions({ filters: { type: "source_lifecycle" } });
  const contexts = useChangeContexts(changes.data?.map((change) => change.id));
  const exceptionData = useExceptionData();
  const label = useActorLabel();
  const [kind, setKind] = useState("");
  const [outcome, setOutcome] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = exceptionData.exceptions.find((item) => item.id === selectedId);
  const action = selected ? exceptionData.actionById.get(selected.action_id) : undefined;
  const unit = action && UNIT_ACTION_TYPES.has(action.type) ? exceptionData.unitById.get(action.target_id ?? "") : undefined;
  const rows = useMemo(() => {
    const actionByChange = new Map([...(reviews.data ?? []), ...(archives.data ?? [])].map((action) => [action.change_set_id, action]));
    const decisions: DecisionRow[] = (changes.data ?? []).flatMap((change) => {
      const description = describeChange(contexts.data?.get(change.id) ?? EMPTY_CONTEXT(change.id), change.summary);
      const isDomainReview = ["domain_steward", "domain_decider"].includes(String(jsonObject(jsonObject(change.actor_attribution).proposedBy).role));
      if (description.type !== "source_review" && description.type !== "source_lifecycle" && !isDomainReview) return [];
      const recorded = jsonObject(change.actor_attribution);
      const decisionAction = actionByChange.get(change.id);
      const input = jsonObject(decisionAction?.input);
      const person = change.proposed_by === "person" ? label("person", change.author_id, null) : null;
      const proposer = person ?? roleLabel(recorded.proposedBy) ?? "Researcher (model not recorded)";
      const decider = person ?? roleLabel(recorded.decidedBy) ?? roleLabel({ role: "reviewer", model: change.model_version });
      return [{ id: change.id, changeSet: change, type: isDomainReview ? "Domain structure" : CHANGE_TYPE_LABEL[description.type], status: change.status,
        summary: change.summary, proposer, decider: decider ?? "–", decision: isDomainReview ? (change.status === "reverted" ? "Reverted" : change.status === "applied" ? "Approved" : change.status === "rejected" ? "Rejected" : "Pending") : decisionOutcome(change, input),
        created_at: change.created_at, tokens: formatTokens(change), href: `/decisions/${change.id}` }];
    });
    for (const exception of exceptionData.exceptions) {
      const linkedAction = exceptionData.actionById.get(exception.action_id);
      const parent = changes.data?.find((change) => change.id === linkedAction?.change_set_id);
      decisions.push({ id: `exception:${exception.id}`, exceptionId: exception.id, changeSet: parent, type: "Exception", status: exception.status,
        summary: exception.note || exception.reason.replaceAll("_", " "), created_at: exception.created_at,
        proposer: parent?.proposed_by === "ai" ? roleLabel(jsonObject(parent.actor_attribution).proposedBy) ?? roleLabel({ role: roleForAction(linkedAction?.type) ?? "reconciler", model: parent.model_version }) ?? "–" : parent ? label(parent.proposed_by, parent.author_id, parent.model_version) : "–",
        decider: exception.status === "open" ? "–" : exception.resolved_by_id ? label("person", exception.resolved_by_id, null) : "Person (not recorded)",
        decision: parent?.status === "reverted" ? "Reverted" : exception.status === "accepted" ? "Approved" : exception.status === "rejected" ? "Rejected" : "Pending",
        tokens: "–" });
    }
    return decisions.filter((row) => (!kind || row.type === kind) && (!outcome || row.decision === outcome)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [changes.data, reviews.data, archives.data, contexts.data, exceptionData.exceptions, exceptionData.actionById, label, kind, outcome]);
  const columns = [
    textColumn<DecisionRow>("status", "Status", (row) => statusLabel(row.status)),
    textColumn<DecisionRow>("decision", "Decision", (row) => row.decision, (row) => <Badge variant="secondary"><StatusDot tone={DECISION_TONE[row.decision] ?? "muted"} label={row.decision} /></Badge>),
    textColumn<DecisionRow>("type", "Type", (row) => row.type),
    { ...textColumn<DecisionRow>("summary", "Summary", (row) => row.summary, (row) => row.href ?
      <TextLink href={row.href} className="block truncate">{row.summary}</TextLink> :
      <button type="button" className="block w-full truncate text-left text-link hover:underline" onClick={() => setSelectedId(row.exceptionId ?? null)}>{row.summary}</button>), meta: { cellClassName: "w-full max-w-0 min-w-48" } },
    textColumn<DecisionRow>("proposer", "Proposed by", (row) => row.proposer),
    textColumn<DecisionRow>("decider", "Decided by", (row) => row.decider),
    textColumn<DecisionRow>("tokens", "Tokens in / out", (row) => row.tokens, (row) => <DecisionTokens row={row} />),
    dateColumn<DecisionRow>("created", "Created", (row) => row.created_at, true),
    menuColumn<DecisionRow>((row) => <DecisionMenu row={row} onOpen={() => setSelectedId(row.exceptionId ?? null)} />),
  ];
  return <div className="flex flex-col gap-3">
    <div className="flex flex-wrap gap-2">
    <NativeSelect aria-label="Decision type" value={kind} onChange={(event) => setKind(event.target.value)} className="w-fit">
      <NativeSelectOption value="">All decisions</NativeSelectOption>
      {["Approver decision", "Archive Decision", "Domain structure", "Exception"].map((type) => <NativeSelectOption key={type} value={type}>{type}</NativeSelectOption>)}
    </NativeSelect>
    <NativeSelect aria-label="Decision outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} className="w-fit">
      <NativeSelectOption value="">All outcomes</NativeSelectOption>
      {["Approved", "Rejected", "Archived", "Restored", "Pending", "Error", "Reverted", "Reinstated"].map((value) => <NativeSelectOption key={value} value={value}>{value}</NativeSelectOption>)}
    </NativeSelect>
    </div>
    <DataTable query={{ data: rows, isPending: changes.isPending || contexts.isPending || reviews.isPending || archives.isPending || exceptionData.state.isPending, error: changes.error ?? contexts.error ?? reviews.error ?? archives.error ?? exceptionData.state.error }}
      columns={columns} getRowId={(row) => row.id} filterPlaceholder="Search decisions…"
      emptyState={<EmptyState icon={DecisionIcon} title="No decisions yet" hint="Approvals, archive decisions, and exceptions appear here." />} />
    <ExceptionDialog exception={selected} action={action} unit={unit} before={action && selected?.status !== "open" ? exceptionData.textsOf(action).before : null} onClose={() => setSelectedId(null)} />
  </div>;
}

function DecisionTokens({ row }: { row: DecisionRow }) {
  const text = <span className="font-mono">{row.tokens}</span>;
  const change = row.changeSet;
  if (row.exceptionId || !change || (change.tokens_in === null && change.tokens_out === null)) return text;
  const cost = change.model_version ? estimateCost(change.model_version, change.tokens_in ?? 0, change.tokens_out ?? 0) : null;
  const content = cost === null
    ? change.model_version ? `No price for ${change.model_version}` : "Model unknown, no cost estimate"
    : `Est. cost ${formatUsd(cost)} · ${change.model_version}`;
  return <Tooltip content={content}>{text}</Tooltip>;
}

function DecisionMenu({ row, onOpen }: { row: DecisionRow; onOpen: () => void }) {
  const canReverse = !!row.changeSet && ["applied", "partly_applied"].includes(row.changeSet.status) && (!row.exceptionId || row.status === "accepted");
  return <RowMenu label={row.summary} items={[
    row.href ? { label: "Open", href: row.href } : { label: "Open", run: onOpen },
    { label: "Reverse decision", isDestructive: true, isDisabled: !canReverse,
      title: canReverse ? "Reverses all applied actions in this decision’s change set." : "Only decisions with applied changes can be reversed. Open pending exceptions to answer them.",
      body: (close) => <ReverseDecision row={row} onDone={close} /> },
  ]} />;
}

function ReverseDecision({ row, onDone }: { row: DecisionRow; onDone: () => void }) {
  const undo = useServerAction(undoChangeSet, { progress: { title: "Reversing decision" } });
  return <DialogForm title="Reverse this decision?" description={`“${row.summary}” will be reversed. This reverses all applied changes in its change set and preserves the history. Later changes may need to be undone first.`}
    submitLabel="Reverse decision" isDestructive isPending={undo.isPending} error={undo.error}
    onSubmit={async () => { if (row.changeSet && (await undo.run(row.changeSet.id)).ok) onDone(); }} />;
}
