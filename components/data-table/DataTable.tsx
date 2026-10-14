"use client";

import { type ColumnDef, flexRender, type Row } from "@tanstack/react-table";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DataTableHeader } from "./DataTableHeader";
import { DataTablePager } from "./DataTablePager";
import { DataTableToolbar } from "./DataTableToolbar";
import { useDataTable } from "./useDataTable";

export type DataTableProps<TData> = {
  // Data comes from a TanStack Query hook in lib/queries (e.g. useUnits())
  query: Pick<UseQueryResult<TData[]>, "data" | "isPending" | "error">;
  columns: ColumnDef<TData, unknown>[];
  getRowId: (row: TData) => string;
  emptyState: ReactNode;
  filterPlaceholder?: string;
  pageSize?: number;
  selectedRowId?: string;
  onRowClick?: (row: TData) => void;
};

// DATA TABLE: sort, filter and paging over one query's rows
export function DataTable<TData>(props: DataTableProps<TData>) {
  const { query, columns, getRowId, pageSize, filterPlaceholder = "Filter…" } = props;
  const table = useDataTable({ data: query.data ?? [], columns, getRowId, pageSize });
  if (query.error) return <ErrorNote error={`Could not load: ${query.error.message}`} />;
  if (query.isPending) return <p className="text-panel text-faint">Loading…</p>;
  if (!query.data?.length) return <>{props.emptyState}</>;
  return (
    <div className="flex flex-col gap-3">
      <DataTableToolbar table={table} placeholder={filterPlaceholder} />
      <Table>
        <DataTableHeader table={table} />
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <DataTableRow key={row.id} row={row} selectedRowId={props.selectedRowId} onRowClick={props.onRowClick} />
          ))}
        </TableBody>
      </Table>
      <DataTablePager table={table} />
    </div>
  );
}

type DataTableRowProps<TData> = Pick<DataTableProps<TData>, "selectedRowId" | "onRowClick"> & { row: Row<TData> };

// ONE BODY ROW: clickable when the page wants a selection (e.g. to fill the right panel)
function DataTableRow<TData>({ row, selectedRowId, onRowClick }: DataTableRowProps<TData>) {
  return (
    <TableRow
      data-state={row.id === selectedRowId ? "selected" : undefined}
      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
      className={cn(onRowClick && "cursor-pointer")}
    >
      {row.getVisibleCells().map((cell) => (
        <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
      ))}
    </TableRow>
  );
}
