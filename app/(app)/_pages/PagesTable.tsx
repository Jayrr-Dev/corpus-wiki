"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { dateColumn, linkColumn, textColumn } from "@/app/(app)/_components/columns";
import { readsState } from "@/app/(app)/_lib/reads";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { PageIcon } from "@/components/icons";
import type { Tables } from "@/lib/database/types";
import { useEntities, usePages } from "@/lib/queries";
import { PageRowActions } from "./PageRowActions";

type PageRow = Tables<"pages"> & { entityName: string };

// COLUMNS: title, the entity it is about, created, and the row actions
const COLUMNS: ColumnDef<PageRow, unknown>[] = [
  linkColumn<PageRow>("title", "Title", (page) => page.title, (page) => `/p/${page.slug}`),
  textColumn<PageRow>("entity", "About", (page) => page.entityName),
  dateColumn<PageRow>("created", "Created", (page) => page.created_at),
  { id: "actions", header: "", enableSorting: false, cell: ({ row }) => <PageRowActions page={row.original} /> },
];

// PAGES TABLE
export function PagesTable() {
  return (
    <DataTable
      query={usePageRows()}
      columns={COLUMNS}
      getRowId={(page) => page.id}
      filterPlaceholder="Search pages…"
      emptyState={<EmptyState icon={PageIcon} title="No pages yet" hint="Create one with New page." />}
    />
  );
}

// Pages with the name of the entity each is about
function usePageRows() {
  const pages = usePages();
  const entities = useEntities();
  const data = useMemo(() => {
    const nameById = new Map((entities.data ?? []).map((entity) => [entity.id, entity.name]));
    return (pages.data ?? []).map((page) => ({ ...page, entityName: nameById.get(page.entity_id ?? "") ?? "—" }));
  }, [pages.data, entities.data]);
  return { data, ...readsState([pages, entities]) };
}
