import { flexRender, type Header, type Table } from "@tanstack/react-table";
import { TableHead, TableHeader, TableRow } from "@/components/ui/table";

// SORT MARKS: shown after a sorted header's label
const SORT_MARK = { asc: " ↑", desc: " ↓" } as const;

// HEADER ROW: click a sortable header to cycle asc → desc → off
export function DataTableHeader<TData>({ table }: { table: Table<TData> }) {
  return (
    <TableHeader>
      {table.getHeaderGroups().map((group) => (
        <TableRow key={group.id} className="hover:bg-transparent">
          {group.headers.map((header) => (
            <TableHead key={header.id}>
              <HeaderLabel header={header} />
            </TableHead>
          ))}
        </TableRow>
      ))}
    </TableHeader>
  );
}

// ONE HEADER CELL'S LABEL, a button when the column can sort
function HeaderLabel<TData>({ header }: { header: Header<TData, unknown> }) {
  if (header.isPlaceholder) return null;
  const label = flexRender(header.column.columnDef.header, header.getContext());
  if (!header.column.getCanSort()) return <>{label}</>;
  const sorted = header.column.getIsSorted();
  return (
    <button type="button" onClick={header.column.getToggleSortingHandler()} className="hover:text-text">
      {label}
      {sorted ? SORT_MARK[sorted] : null}
    </button>
  );
}
