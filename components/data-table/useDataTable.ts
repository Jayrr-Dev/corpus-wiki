import {
  type ColumnDef,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  type Table,
  useReactTable,
} from "@tanstack/react-table";
import { useState } from "react";

export type UseDataTableOptions<TData> = {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  getRowId?: (row: TData) => string;
  pageSize?: number;
  initialSorting?: SortingState;
};

// TABLE STATE: sorting, one text filter across all columns, and paging (all client side;
// the prototype holds a few dozen rows per table, so server paging is not needed)
export function useDataTable<TData>({
  data,
  columns,
  getRowId,
  pageSize = 25,
  initialSorting = [],
}: UseDataTableOptions<TData>): Table<TData> {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [globalFilter, setGlobalFilter] = useState("");
  // TanStack Table returns functions that change identity; the React Compiler lint knows this
  // eslint-disable-next-line react-hooks/incompatible-library
  return useReactTable({
    data,
    columns,
    getRowId,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });
}
