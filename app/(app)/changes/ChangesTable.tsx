"use client";

import { useMemo } from "react";
import { TextLink } from "@/app/(app)/_components/bits";
import { dateColumn, statusColumn, textColumn } from "@/app/(app)/_components/columns";
import { formatTokens } from "@/app/(app)/_lib/format";
import { type ActorLabel, useActorLabel } from "@/app/(app)/_lib/useActorLabel";
import { CHANGE_SET_TONE } from "@/app/(app)/_lib/tone";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { ChangeIcon } from "@/components/icons";
import { menuColumn } from "@/components/row-menu/RowMenu";
import { Tooltip } from "@/components/standard/tooltip";
import { estimateCost, formatUsd } from "@/lib/ai/pricing";
import type { Tables } from "@/lib/database/types";
import { Badge } from "@/components/ui/badge";
import { type ChangeContext, useChangeContexts, useChangeSets } from "@/lib/queries";
import { ChangeDiffPreview } from "./ChangeDiffPreview";
import { ChangeFilterBar } from "./ChangeFilterBar";
import { ChangeRowMenu } from "./ChangeRowMenu";
import { CHANGE_TYPE_LABEL, type ChangeDescription, describeChange, EMPTY_CONTEXT } from "./describeChange";
import { filterChanges } from "./filterChanges";
import { useChangeFilters } from "./useChangeFilters";
import { jsonObject, roleLabel, roleForAction } from "../decisions/describeDecision";

type ChangeSet = Tables<"change_sets">;

// ONE ROW: the change set with what its actions say about it (until they load, just the change set)
type ChangeRow = ChangeSet & { described: ChangeDescription | null; proposer: string };

const summaryOf = (row: ChangeRow) => row.described?.summary ?? row.summary;
const truncated = (value: string | null | undefined, hint?: string | null) =>
  value ? (
    <Tooltip content={hint ?? value}>
      <span className="block max-w-48 truncate">{value}</span>
    </Tooltip>
  ) : (
    <span className="text-muted-foreground">–</span>
  );

// TOKENS: "in / out" in mono; hovering shows the estimated cost at the model's list price
function TokensCell({ row }: { row: ChangeRow }) {
  const text = <span className="font-mono">{formatTokens(row)}</span>;
  if (row.tokens_in === null && row.tokens_out === null) return text;
  const cost = row.model_version ? estimateCost(row.model_version, row.tokens_in ?? 0, row.tokens_out ?? 0) : null;
  const content =
    cost === null
      ? row.model_version ? `No price for ${row.model_version}` : "Model unknown, no cost estimate"
      : `Est. cost ${formatUsd(cost)} · ${row.model_version}`;
  return <Tooltip content={content}>{text}</Tooltip>;
}

// COLUMNS: status dot, type, where it landed (domain, section), summary, who proposed it, token cost, when, and the "…" menu.
// One line per row: long text truncates, the full text is in the tooltip.
const COLUMNS = [
  statusColumn<ChangeRow, ChangeSet["status"]>("Status", (row) => row.status, CHANGE_SET_TONE),
  textColumn<ChangeRow>("type", "Type", (row) => (row.described ? CHANGE_TYPE_LABEL[row.described.type] : ""), (row) =>
    row.described ? <Badge variant="secondary">{CHANGE_TYPE_LABEL[row.described.type]}</Badge> : null),
  textColumn<ChangeRow>("domain", "Domain", (row) => row.described?.domain ?? "", (row) => truncated(row.described?.domain, row.described?.domainPath)),
  textColumn<ChangeRow>("section", "Section", (row) => row.described?.section ?? "", (row) => truncated(row.described?.section)),
  // Summary takes whatever width is left (w-full + max-w-0 lets it shrink and truncate instead of forcing a scrollbar)
  {
    ...textColumn<ChangeRow>("summary", "Summary", summaryOf, (row) => (
      <Tooltip className="max-w-[min(38rem,calc(100vw-2rem))]" content={<ChangeDiffPreview changeSetId={row.id} summary={summaryOf(row)} />}>
        <TextLink href={`/changes/${row.id}`} className="block truncate">
          {summaryOf(row)}
        </TextLink>
      </Tooltip>
    )),
    meta: { cellClassName: "w-full max-w-0 min-w-48" },
  },
  textColumn<ChangeRow>("proposed", "Proposed by", (row) => row.proposer, (row) => truncated(row.proposer)),
  textColumn<ChangeRow>("tokens", "Tokens in / out", formatTokens, (row) => <TokensCell row={row} />),
  dateColumn<ChangeRow>("created", "Created", (row) => row.created_at, true),
  menuColumn<ChangeRow>((row) => <ChangeRowMenu changeSet={row} />),
];

// Pairs each change set with its description (none while the actions load or if they fail)
function describeAll(changeSets: ChangeSet[], contexts: Map<string, ChangeContext> | undefined, label: ActorLabel): ChangeRow[] {
  return changeSets.map((changeSet) => ({
    ...changeSet,
    proposer: changeSet.proposed_by === "ai"
      ? (roleLabel(jsonObject(changeSet.actor_attribution).proposedBy)
        ?? [...new Set((contexts?.get(changeSet.id)?.action_types ?? []).map(roleForAction).filter((role) => role !== null))]
          .map((role) => roleLabel({ role, model: changeSet.model_version })).join(", "))
        || label(changeSet.proposed_by, changeSet.author_id, changeSet.model_version)
      : label(changeSet.proposed_by, changeSet.author_id, changeSet.model_version),
    described: contexts ? describeChange(contexts.get(changeSet.id) ?? EMPTY_CONTEXT(changeSet.id), changeSet.summary) : null,
  }));
}

// CHANGES TABLE: newest first (the hook's default order), narrowed by the sidebar filters
export function ChangesTable() {
  const filterState = useChangeFilters();
  const changeSets = useChangeSets();
  const { filters } = filterState;
  const listed = useMemo(() => (changeSets.data ? filterChanges(changeSets.data, filters) : undefined), [changeSets.data, filters]);
  const contexts = useChangeContexts(changeSets.data?.map((changeSet) => changeSet.id));
  const label = useActorLabel();
  const data = useMemo(() => (listed && contexts.data ? describeAll(listed, contexts.data, label).filter((row) => row.described?.type !== "source_review" && row.described?.type !== "source_lifecycle") : undefined), [listed, contexts.data, label]);
  const filtered = Object.values(filters).some(Boolean);
  return (
    <div className="flex flex-col gap-3">
      <div className="md:hidden"><ChangeFilterBar {...filterState} /></div>
      <DataTable
        query={{ data, isPending: changeSets.isPending || contexts.isPending, error: changeSets.error ?? contexts.error }}
        columns={COLUMNS}
        getRowId={(changeSet) => changeSet.id}
        filterPlaceholder="Search changes…"
        emptyState={
          filtered ? (
            <EmptyState icon={ChangeIcon} title="No changes match" hint="Change or reset the filters." />
          ) : (
            <EmptyState icon={ChangeIcon} title="No changes yet" hint="Uploads and edits appear here." />
          )
        }
      />
    </div>
  );
}
