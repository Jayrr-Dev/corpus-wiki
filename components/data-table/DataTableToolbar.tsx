import type { Table } from "@tanstack/react-table";
import { Input } from "@/components/ui/input";

type DataTableToolbarProps<TData> = { table: Table<TData>; placeholder: string };

// TOOLBAR: one filter box that searches every column
export function DataTableToolbar<TData>({ table, placeholder }: DataTableToolbarProps<TData>) {
  return (
    <Input
      value={String(table.getState().globalFilter ?? "")}
      onChange={(event) => table.setGlobalFilter(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="max-w-xs"
    />
  );
}
