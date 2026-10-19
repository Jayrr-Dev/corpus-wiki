"use client";

import { ErrorNote } from "@/app/(app)/_components/bits";
import { Loader } from "@/components/standard/loader";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { UseQueryResult } from "@tanstack/react-query";
import { type ColumnDef, flexRender, type Row, type RowData } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { DataTableHeader } from "./DataTableHeader";
import { DataTablePager } from "./DataTablePager";
import { DataTableToolbar } from "./DataTableToolbar";
import { useDataTable } from "./useDataTable";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    // Extra classes for this column's body cells (e.g. `w-full max-w-0` to let one column absorb the spare width)
    cellClassName?: string;
  }
}

export type DataTableProps<TData> = {
  // Data comes from a TanStack Query hook in lib/queries (e.g. useUnits())
  query: Pick<UseQueryResult<TData[]>, "data" | "isPending" | "error">;
  columns: ColumnDef<TData, unknown>[];
  getRowId: (row: TData) => string;
  emptyState: ReactNode;
  filterPlaceholder?: string;
  toolbarEnd?: ReactNode;
  pageSize?: number;
  selectedRowId?: string;
  onRowClick?: (row: TData) => void;
  detail?: (row: TData) => ReactNode;
};

// DATA TABLE: sort, filter and paging over one query's rows
export function DataTable<TData>(props: DataTableProps<TData>) {
  const { query, columns, getRowId, pageSize, filterPlaceholder = "Filter…" } = props;
  const table = useDataTable({ data: query.data ?? [], columns, getRowId, pageSize });
  if (query.error) return <ErrorNote error={`Could not load: ${query.error.message}`} />;
  if (query.isPending) return <Loader />;
  if (!query.data?.length) {
    if (!props.toolbarEnd) return <>{props.emptyState}</>;
    return (
      <div className="flex flex-col gap-3">
        <DataTableToolbar table={table} placeholder={filterPlaceholder} end={props.toolbarEnd} />
        {props.emptyState}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <DataTableToolbar table={table} placeholder={filterPlaceholder} end={props.toolbarEnd} />
      <Table>
        <DataTableHeader table={table} />
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <DataTableRow key={row.id} row={row} selectedRowId={props.selectedRowId} onRowClick={props.onRowClick} detail={props.detail} />
          ))}
        </TableBody>
      </Table>
      <DataTablePager table={table} />
    </div>
  );
}

type DataTableRowProps<TData> = Pick<DataTableProps<TData>, "selectedRowId" | "onRowClick" | "detail"> & { row: Row<TData> };

// ONE BODY ROW: clickable when the page wants a selection (e.g. to fill the right panel)
function DataTableRow<TData>({ row, selectedRowId, onRowClick, detail }: DataTableRowProps<TData>) {
  const extra = detail?.(row.original);
  return (
    <>
      <TableRow
        data-state={row.id === selectedRowId ? "selected" : undefined}
        onClick={onRowClick ? () => onRowClick(row.original) : undefined}
        className={cn(onRowClick && "cursor-pointer")}
      >
        {row.getVisibleCells().map((cell) => (
          // eslint-disable-next-line shadcn/require-static-classes -- width classes come from the column definition
          <TableCell key={cell.id} className={cell.column.columnDef.meta?.cellClassName}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
        ))}
      </TableRow>
      {extra ? (
        <TableRow>
          <TableCell colSpan={row.getVisibleCells().length} className="whitespace-normal">{extra}</TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
