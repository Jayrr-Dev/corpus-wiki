"use client";

import { dateColumn, linkColumn } from "@/app/(app)/_components/columns";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { SourceIcon } from "@/components/icons";
import { menuColumn } from "@/components/row-menu/RowMenu";
import type { Tables } from "@/lib/database/types";
import { useSources } from "@/lib/queries";
import { SourceRowMenu } from "./SourceRowMenu";

type Source = Tables<"sources">;

// COLUMNS: title, the file's own date, when it was uploaded, and the "…" menu
const COLUMNS = [
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
