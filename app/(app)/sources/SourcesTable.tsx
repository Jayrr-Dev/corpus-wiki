"use client";

import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { dateColumn, linkColumn, textColumn } from "@/app/(app)/_components/columns";
import { SOURCE_STATE_TONE } from "@/app/(app)/_lib/tone";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { SourceIcon } from "@/components/icons";
import { menuColumn } from "@/components/row-menu/RowMenu";
import type { Tables } from "@/lib/database/types";
import { sourceState } from "@/lib/knowledge/evidence";
import { useSources } from "@/lib/queries";
import { SourceRowMenu } from "./SourceRowMenu";

type Source = Tables<"sources">;

// COLUMNS: state, title, the file's own date, when it was uploaded, and the "…" menu
const COLUMNS = [
  textColumn<Source>("state", "State", (source) => sourceState(source), (source) => (
    <StatusDot tone={SOURCE_STATE_TONE[sourceState(source)]} label={sourceState(source)} />
  )),
  linkColumn<Source>("title", "Title", (source) => source.title, (source) => `/sources/${source.id}`),
  dateColumn<Source>("sourceDate", "Source date", (source) => source.source_date),
  dateColumn<Source>("uploaded", "Uploaded", (source) => source.created_at, true),
  menuColumn<Source>((source) => <SourceRowMenu source={source} />),
];

// SOURCES TABLE
export function SourcesTable() {
  return (
    <DataTable
      query={useSources()}
      columns={COLUMNS}
      getRowId={(source) => source.id}
      filterPlaceholder="Search sources…"
      emptyState={<EmptyState icon={SourceIcon} title="No sources yet" hint="Upload a file to add one." />}
    />
  );
}
