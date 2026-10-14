import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { fetchRowById, fetchRows, type IdTableName, type ListOptions, type Row, type TableName } from "./fetchers";
import { queryKeys } from "./keys";

// Lists rows of any table through the browser client (read-only via RLS)
export function useTableList<T extends TableName>(
  table: T,
  options: ListOptions<T> = {},
  enabled = true,
): UseQueryResult<Row<T>[]> {
  return useQuery({
    queryKey: queryKeys.list(table, options),
    // The client is created inside queryFn so server rendering never needs browser env
    queryFn: () => fetchRows(getBrowserSupabase(), table, options),
    enabled,
  });
}

// Reads one row by id; idle until an id is given
export function useTableRow<T extends IdTableName>(
  table: T,
  id: string | undefined,
): UseQueryResult<Row<T> | null> {
  return useQuery({
    queryKey: queryKeys.row(table, id ?? ""),
    queryFn: () => fetchRowById(getBrowserSupabase(), table, id ?? ""),
    enabled: Boolean(id),
  });
}
