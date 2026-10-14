import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getBrowserSupabase, type BrowserSupabase } from "@/lib/supabase/client";
import { fetchRowById, type Row } from "./fetchers";
import { queryKeys } from "./keys";

// =====================================================================
// SCREEN READ HOOKS: the reads the table hooks in ./index.ts cannot
// express (id lists, array overlaps, either-side links, polling).
// Keys start with ["table", <table>] so invalidating a table refreshes them.
// =====================================================================

// SHARED SHAPES
export type UnitSummary = Row<"units"> & { content: string };

// TABLES THAT HAVE A UUID `id` AND ARE READ BY ID LISTS HERE
type ByIdTable = "units" | "revisions" | "passages" | "sources" | "entities" | "domains" | "actions";

// Reads rows by id; an empty list reads nothing
async function fetchByIds<T extends ByIdTable>(client: BrowserSupabase, table: T, ids: readonly string[]): Promise<Row<T>[]> {
  if (ids.length === 0) return [];
  // The generic `from(table)` cannot type `.in("id")`, so the PostgREST filter is written out
  const { data, error } = await client.from(table).select("*").filter("id", "in", `(${ids.join(",")})`);
  if (error) throw error;
  return (data ?? []) as unknown as Row<T>[];
}

// Sorted, de-duplicated ids so the query key is stable
function uniqueIds(ids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))].sort();
}

// ROWS BY ID LIST (any of the tables above)
export function useRowsByIds<T extends ByIdTable>(table: T, ids: readonly (string | null | undefined)[]): UseQueryResult<Row<T>[]> {
  const list = uniqueIds(ids);
  return useQuery({
    queryKey: [...queryKeys.table(table), "ids", list],
    queryFn: () => fetchByIds(getBrowserSupabase(), table, list),
  });
}

// Reads units (all, or by id) with their current revision's content
async function fetchUnitSummaries(client: BrowserSupabase, ids: string[] | null): Promise<UnitSummary[]> {
  let query = client.from("units").select("*").order("last_changed_at", { ascending: false });
  if (ids) query = query.in("id", ids);
  const { data, error } = await query;
  if (error) throw error;
  const units = (data ?? []) as Row<"units">[];
  const revisions = await fetchByIds(client, "revisions", units.map((unit) => unit.current_revision_id));
  const contentById = new Map(revisions.map((revision) => [revision.id, revision.content]));
  return units.map((unit) => ({ ...unit, content: contentById.get(unit.current_revision_id) ?? "" }));
}

// UNITS WITH CONTENT: every unit when `ids` is omitted, else just those
export function useUnitSummaries(ids?: readonly (string | null | undefined)[]): UseQueryResult<UnitSummary[]> {
  const list = ids ? uniqueIds(ids) : null;
  return useQuery({
    queryKey: [...queryKeys.table("units"), "summaries", list],
    queryFn: () => (list?.length === 0 ? Promise.resolve([]) : fetchUnitSummaries(getBrowserSupabase(), list)),
  });
}

// Reads a unit's links in both directions, newest first
async function fetchUnitRelationships(client: BrowserSupabase, unitId: string): Promise<Row<"relationships">[]> {
  const { data, error } = await client
    .from("relationships")
    .select("*")
    .or(`from_unit_id.eq.${unitId},to_unit_id.eq.${unitId}`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// LINKS OF ONE UNIT (from it and to it)
export function useUnitRelationships(unitId: string): UseQueryResult<Row<"relationships">[]> {
  return useQuery({
    queryKey: [...queryKeys.table("relationships"), "unit", unitId],
    queryFn: () => fetchUnitRelationships(getBrowserSupabase(), unitId),
  });
}

// Reads actions whose evidence includes any of the passages
async function fetchActionsForPassages(client: BrowserSupabase, passageIds: string[]): Promise<Row<"actions">[]> {
  if (passageIds.length === 0) return [];
  const { data, error } = await client.from("actions").select("*").overlaps("passage_ids", passageIds);
  if (error) throw error;
  return data ?? [];
}

// ACTIONS CITING PASSAGES (Source detail: what each passage produced)
export function useActionsForPassages(passageIds: readonly string[]): UseQueryResult<Row<"actions">[]> {
  const list = uniqueIds(passageIds);
  return useQuery({
    queryKey: [...queryKeys.table("actions"), "passages", list],
    queryFn: () => fetchActionsForPassages(getBrowserSupabase(), list),
  });
}

// ONE SHIFT EVENT, POLLED EVERY SECOND WHILE `isLive` (Upload: watch the pipeline move)
export function useLiveShiftEvent(eventId: string | undefined, isLive: boolean): UseQueryResult<Row<"shift_events"> | null> {
  return useQuery({
    queryKey: queryKeys.row("shift_events", eventId ?? ""),
    queryFn: () => fetchRowById(getBrowserSupabase(), "shift_events", eventId ?? ""),
    enabled: Boolean(eventId),
    refetchInterval: isLive ? 1000 : false,
  });
}
