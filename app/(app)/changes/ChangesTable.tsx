"use client";

import { useMemo } from "react";
import { TextLink } from "@/app/(app)/_components/bits";
import { dateColumn, statusColumn, textColumn } from "@/app/(app)/_components/columns";
import { formatTokens } from "@/app/(app)/_lib/format";
import { CHANGE_SET_TONE } from "@/app/(app)/_lib/tone";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { ChangeIcon } from "@/components/icons";
import { menuColumn } from "@/components/row-menu/RowMenu";
import type { Tables } from "@/lib/database/types";
import { Badge } from "@/components/ui/badge";
import { type ChangeContext, useChangeContexts, useChangeSets } from "@/lib/queries";
import { ChangeFilterBar } from "./ChangeFilterBar";
import { ChangeRowMenu } from "./ChangeRowMenu";
import { CHANGE_TYPE_LABEL, type ChangeDescription, describeChange, EMPTY_CONTEXT } from "./describeChange";
import { filterChanges } from "./filterChanges";
import { useChangeFilters } from "./useChangeFilters";

type ChangeSet = Tables<"change_sets">;

// ONE ROW: the change set with what its actions say about it (until they load, just the change set)
type ChangeRow = ChangeSet & { described: ChangeDescription | null };

const summaryOf = (row: ChangeRow) => row.described?.summary ?? row.summary;
const truncated = (value: string | null | undefined, title?: string | null) =>
  value ? <span className="block max-w-48 truncate" title={title ?? value}>{value}</span> : <span className="text-muted-foreground">–</span>;

// COLUMNS: status dot, type, where it landed (domain, section), summary, who proposed it, token cost, when, and the "…" menu.
// One line per row: long text truncates, the full text is in the tooltip.
const COLUMNS = [
  statusColumn<ChangeRow, ChangeSet["status"]>("Status", (row) => row.status, CHANGE_SET_TONE),
  textColumn<ChangeRow>("type", "Type", (row) => (row.described ? CHANGE_TYPE_LABEL[row.described.type] : ""), (row) =>
    row.described ? <Badge variant="secondary">{CHANGE_TYPE_LABEL[row.described.type]}</Badge> : null),
  textColumn<ChangeRow>("domain", "Domain", (row) => row.described?.domain ?? "", (row) => truncated(row.described?.domain, row.described?.domainPath)),
  textColumn<ChangeRow>("section", "Section", (row) => row.described?.section ?? "", (row) => truncated(row.described?.section)),
  textColumn<ChangeRow>("summary", "Summary", summaryOf, (row) => (
    <TextLink href={`/changes/${row.id}`} className="block max-w-md truncate" title={row.summary}>
      {summaryOf(row)}
    </TextLink>
  )),
  textColumn<ChangeRow>("proposed", "Proposed by", (row) => row.proposed_by),
  textColumn<ChangeRow>("tokens", "Tokens in / out", formatTokens, (row) => <span className="font-mono">{formatTokens(row)}</span>),
  dateColumn<ChangeRow>("created", "Created", (row) => row.created_at, true),
  menuColumn<ChangeRow>((row) => <ChangeRowMenu changeSet={row} />),
];

// Pairs each change set with its description (none while the actions load or if they fail)
function describeAll(changeSets: ChangeSet[], contexts: Map<string, ChangeContext> | undefined): ChangeRow[] {
  return changeSets.map((changeSet) => ({
    ...changeSet,
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
  const data = useMemo(() => (listed ? describeAll(listed, contexts.data) : undefined), [listed, contexts.data]);
  const filtered = Object.values(filters).some(Boolean);
  return (
    <div className="flex flex-col gap-3">
      <div className="md:hidden"><ChangeFilterBar {...filterState} /></div>
      <DataTable
        query={{ data, isPending: changeSets.isPending, error: changeSets.error }}
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
