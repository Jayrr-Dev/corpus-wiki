"use client";

import { dateColumn, linkColumn, statusColumn, textColumn } from "@/app/(app)/_components/columns";
import { formatTokens } from "@/app/(app)/_lib/format";
import { CHANGE_SET_TONE } from "@/app/(app)/_lib/tone";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { ChangeIcon } from "@/components/icons";
import { menuColumn } from "@/components/row-menu/RowMenu";
import type { Tables } from "@/lib/database/types";
import { useChangeSets } from "@/lib/queries";
import { ChangeRowMenu } from "./ChangeRowMenu";

type ChangeSet = Tables<"change_sets">;

// COLUMNS: status dot, summary, who proposed it, token cost, when, and the "…" menu
const COLUMNS = [
  statusColumn<ChangeSet, ChangeSet["status"]>("Status", (changeSet) => changeSet.status, CHANGE_SET_TONE),
  linkColumn<ChangeSet>("summary", "Summary", (changeSet) => changeSet.summary, (changeSet) => `/changes/${changeSet.id}`),
  textColumn<ChangeSet>("proposed", "Proposed by", (changeSet) => changeSet.proposed_by),
  textColumn<ChangeSet>("tokens", "Tokens in / out", formatTokens, (changeSet) => <span className="font-mono">{formatTokens(changeSet)}</span>),
  dateColumn<ChangeSet>("created", "Created", (changeSet) => changeSet.created_at, true),
  menuColumn<ChangeSet>((changeSet) => <ChangeRowMenu changeSet={changeSet} />),
];

// CHANGES TABLE: newest first (the hook's default order)
export function ChangesTable() {
  return (
    <DataTable
      query={useChangeSets()}
      columns={COLUMNS}
      getRowId={(changeSet) => changeSet.id}
      filterPlaceholder="Search changes…"
      emptyState={<EmptyState icon={ChangeIcon} title="No changes yet" hint="Uploads and edits appear here." />}
    />
  );
}
