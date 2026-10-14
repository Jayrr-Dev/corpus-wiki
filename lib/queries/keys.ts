import type { IdTableName, ListOptions, TableName } from "./fetchers";

// QUERY KEYS: one place, so Realtime handlers (agent D) can invalidate by table
export const queryKeys = {
  table: (table: TableName) => ["table", table] as const,
  list: <T extends TableName>(table: T, options: ListOptions<T> = {}) =>
    ["table", table, "list", options] as const,
  row: (table: IdTableName, id: string) => ["table", table, "row", id] as const,
};
