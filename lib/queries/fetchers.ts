import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database/types";

// TABLE NAME TYPES (derived from the generated types, never hand-written)
export type TableName = keyof Database["public"]["Tables"];
export type Row<T extends TableName> = Tables<T>;

// Tables whose rows have a uuid `id` (the join tables do not)
export type IdTableName = {
  [K in TableName]: Row<K> extends { id: string } ? K : never;
}[TableName];

// LIST OPTIONS: equality filters (null means "is null"), one sort column, an optional cap
export type ListOptions<T extends TableName> = {
  filters?: Partial<Row<T>>;
  orderBy?: keyof Row<T> & string;
  ascending?: boolean;
  limit?: number;
};

type Client = SupabaseClient<Database>;
const PAGE_SIZE = 500;
const COMPOSITE_KEYS: Partial<Record<TableName, string[]>> = {
  unit_entities: ["unit_id", "entity_id", "role"], unit_domains: ["unit_id", "domain_id"],
  section_inputs: ["section_id", "unit_id"], entity_profiles: ["entity_id"],
  unit_embeddings: ["model", "revision_id"], glossary_embeddings: ["model", "entry_hash"], asset_tag_aliases: ["alias"],
};

// Reads rows of one table; throws the PostgREST error so TanStack Query shows it
export async function fetchRows<T extends TableName>(
  client: Client,
  table: T,
  options: ListOptions<T> = {},
): Promise<Row<T>[]> {
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 0)) throw new Error("List limit must be a nonnegative integer.");
  if (options.limit === 0) return [];
  const rows: Row<T>[] = [];
  // Read below the API row cap with stable tie breakers. Existing list callers
  // expect complete collections, including joins used for counts and filters.
  for (;;) {
  let query = client.from(table).select("*");
  const filters = Object.entries(options.filters ?? {});
  const equal = Object.fromEntries(filters.filter(([, value]) => value !== null));
  if (filters.length > 0) query = query.match(equal as Record<string, string>);
  for (const [column] of filters.filter(([, value]) => value === null)) query = query.filter(column, "is", null);
  if (options.orderBy) query = query.order(options.orderBy, { ascending: options.ascending ?? true });
  for (const column of COMPOSITE_KEYS[table] ?? ["id"]) {
    if (column !== options.orderBy) query = query.order(column, { ascending: true });
  }
  const size = Math.min(PAGE_SIZE, (options.limit ?? Infinity) - rows.length);
  query = query.range(rows.length, rows.length + size - 1);
  const { data, error } = await query;
  if (error) throw error;
  const page = (data ?? []) as unknown as Row<T>[];
  rows.push(...page);
  if (page.length < size || rows.length === options.limit) return rows;
  }
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
