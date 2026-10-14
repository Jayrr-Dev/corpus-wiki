import type { Table } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";

// PAGER: row count, page position, previous and next
export function DataTablePager<TData>({ table }: { table: Table<TData> }) {
  const { pageIndex } = table.getState().pagination;
  const pageCount = Math.max(table.getPageCount(), 1);
  return (
    <div className="flex items-center justify-between text-panel text-muted-foreground">
      <span className="font-mono text-faint">{table.getFilteredRowModel().rows.length} rows</span>
      <div className="flex items-center gap-2">
        <span>
          Page {pageIndex + 1} of {pageCount}
        </span>
        <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
          Previous
        </Button>
        <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
          Next
        </Button>
      </div>
    </div>
  );
}
