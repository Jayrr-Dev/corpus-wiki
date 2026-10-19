import { expect, it } from "vitest";
import type { BrowserSupabase } from "@/lib/supabase/client";
import { fetchActionsForPassages, fetchUnitSummaries } from "./screens";

type RecordRow = Record<string, unknown>;
// Models both failure modes from the book: bounded URLs and a capped API response.
function database(tables: Record<string, RecordRow[]>): BrowserSupabase {
  return { from(table: string) {
    let rows = [...(tables[table] ?? [])];
    const orders: [string, boolean][] = [];
    let start = 0, end = 999;
    const selectIds = (column: string, ids: string[]) => {
      if (ids.length > 100) throw new Error("Oversized ID filter");
      rows = rows.filter((row) => ids.includes(String(row[column])));
      return query;
    };
    const query = {
      select: () => query,
      in: selectIds,
      filter: (column: string, _operator: string, value: string) => selectIds(column, value.slice(1, -1).split(",")),
      overlaps: (column: string, ids: string[]) => {
        if (ids.length > 100) throw new Error("Oversized overlap filter");
        rows = rows.filter((row) => (row[column] as string[]).some((id) => ids.includes(id)));
        return query;
      },
      order: (column: string, options?: { ascending?: boolean }) => { orders.push([column, options?.ascending ?? true]); return query; },
      range: (from: number, to: number) => { start = from; end = to; return query; },
      then: (resolve: (result: { data: RecordRow[]; error: null }) => unknown) => Promise.resolve(resolve({
        data: rows.sort((a, b) => {
          for (const [column, ascending] of orders) {
            const compared = String(a[column]).localeCompare(String(b[column]));
            if (compared) return ascending ? compared : -compared;
          }
          return 0;
        }).slice(start, end + 1), error: null,
      })),
    };
    return query;
  } } as unknown as BrowserSupabase;
}

it("loads all actions for a book, including capped pages and cross-batch citations", async () => {
  const ids = Array.from({ length: 1402 }, (_, i) => `passage-${i}`);
  const actions = Array.from({ length: 1203 }, (_, i) => ({ id: `action-${i}`, passage_ids: [ids[0], ids[101]] }));
  const rows = await fetchActionsForPassages(database({ actions }), ids);
  expect(rows).toHaveLength(1203);
  expect(new Set(rows.map((row) => row.id)).size).toBe(1203);
});

it("hydrates every book claim beyond the row cap with bounded joins and correct source origin", async () => {
  const units = Array.from({ length: 1203 }, (_, i) => ({ id: `unit-${i}`, current_revision_id: `revision-${i}`, last_changed_at: "2026-10-18T08:00:00Z" }));
  const client = database({
    units,
    revisions: units.map((unit) => ({ id: unit.current_revision_id, content: `Evidence for ${unit.id}`, title: null })),
    unit_entities: units.map((unit) => ({ unit_id: unit.id, entity_id: "subject", role: "subject" })),
    entities: [{ id: "subject", name: "Enneagram", type: "concept", merged_into_id: null }],
    source_units: units.map((unit) => ({ unit_id: unit.id, source_id: "book" })),
    sources: [{ id: "book", origin: "internal" }],
  });
  for (const ids of [units.map((unit) => unit.id), null]) {
    const summaries = await fetchUnitSummaries(client, ids);
    expect(summaries).toHaveLength(1203);
    expect(summaries.every((unit) => unit.content === `Evidence for ${unit.id}` && unit.sourceOrigin === "internal")).toBe(true);
  }
});
