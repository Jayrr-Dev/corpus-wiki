import { Input } from "@/components/ui/input";
import type { Table } from "@tanstack/react-table";
import type { ReactNode } from "react";

type DataTableToolbarProps<TData> = { table: Table<TData>; placeholder: string; end?: ReactNode };

// TOOLBAR: one filter box that searches every column, with optional controls to its right
export function DataTableToolbar<TData>({ table, placeholder, end }: DataTableToolbarProps<TData>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={String(table.getState().globalFilter ?? "")}
        onChange={(event) => table.setGlobalFilter(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="max-w-xs"
      />
      {end}
    </div>
  );
}
