import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database/types";
import { fetchRows } from "./fetchers";
it("reads beyond the row cap and respects an explicit cap with deterministic ordering", async () => {
  const rows = Array.from({ length: 1203 }, (_, index) => ({ id: String(index) }));
  const ranges: number[][] = [];
  const order = vi.fn();
  const client = { from() { return { select() {
    const query = { match: () => query, filter: () => query, order: (...args: unknown[]) => { order(...args); return query; },
      range: async (from: number, to: number) => { ranges.push([from, to]); return { data: rows.slice(from, to + 1), error: null }; } };
    return query;
  } }; } } as unknown as SupabaseClient<Database>;
  expect(await fetchRows(client, "units", { orderBy: "last_changed_at", ascending: false })).toHaveLength(1203);
  expect(ranges).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  expect(order).toHaveBeenCalledWith("id", { ascending: true });
  ranges.length = 0;
  expect(await fetchRows(client, "units", { limit: 600 })).toHaveLength(600);
  expect(ranges).toEqual([[0, 499], [500, 599]]);
  expect(await fetchRows(client, "units", { limit: 0 })).toEqual([]);
});
