"use client";

import { useMemo } from "react";
import { dateColumn, linkColumn, statusColumn, textColumn } from "@/app/(app)/_components/columns";
import { formatTokens } from "@/app/(app)/_lib/format";
import { CHANGE_SET_TONE } from "@/app/(app)/_lib/tone";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { ChangeIcon } from "@/components/icons";
import { menuColumn } from "@/components/row-menu/RowMenu";
import type { Tables } from "@/lib/database/types";
import { useChangeSets } from "@/lib/queries";
import { ChangeFilterBar } from "./ChangeFilterBar";
import { ChangeRowMenu } from "./ChangeRowMenu";
import { filterChanges } from "./filterChanges";
import { useChangeFilters } from "./useChangeFilters";

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

// CHANGES TABLE: newest first (the hook's default order), narrowed by the sidebar filters
export function ChangesTable() {
  const filterState = useChangeFilters();
  const changeSets = useChangeSets();
  const { filters } = filterState;
  const data = useMemo(() => (changeSets.data ? filterChanges(changeSets.data, filters) : undefined), [changeSets.data, filters]);
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
