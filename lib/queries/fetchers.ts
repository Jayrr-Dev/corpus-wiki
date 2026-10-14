import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database/types";

// TABLE NAME TYPES (derived from the generated types, never hand-written)
export type TableName = keyof Database["public"]["Tables"];
export type Row<T extends TableName> = Tables<T>;

// Tables whose rows have a uuid `id` (the join tables do not)
export type IdTableName = {
  [K in TableName]: Row<K> extends { id: string } ? K : never;
}[TableName];

// LIST OPTIONS: equality filters, one sort column, an optional cap
export type ListOptions<T extends TableName> = {
  filters?: Partial<Row<T>>;
  orderBy?: keyof Row<T> & string;
  ascending?: boolean;
  limit?: number;
};

type Client = SupabaseClient<Database>;

// Reads rows of one table; throws the PostgREST error so TanStack Query shows it
export async function fetchRows<T extends TableName>(
  client: Client,
  table: T,
  options: ListOptions<T> = {},
): Promise<Row<T>[]> {
  // The generic `from(table)` loses the row type, so the result is narrowed once here
  let query = client.from(table).select("*");
  if (options.filters) query = query.match(options.filters as Record<string, string>);
  if (options.orderBy) query = query.order(options.orderBy, { ascending: options.ascending ?? true });
  if (options.limit) query = query.limit(options.limit);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as Row<T>[];
}

// Reads one row by id; null when it does not exist (or RLS hides it)
export async function fetchRowById<T extends IdTableName>(
  client: Client,
  table: T,
  id: string,
): Promise<Row<T> | null> {
  const { data, error } = await client.from(table).select("*").match({ id }).maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as Row<T> | null;
}
