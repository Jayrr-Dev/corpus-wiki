import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database/types";
import { fetchAllAiCalls } from "./allAiCalls";

// A fake client over `total` rows whose API returns at most `cap` rows per request
function fakeClient(total: number, cap: number) {
  const rows = Array.from({ length: total }, (_, index) => ({ id: String(index) }));
  const ranges: number[][] = [];
  const client = { from() { return { select(_columns: string, options?: { count?: string }) {
    const query = { order: () => query, range: async (from: number, to: number) => {
      ranges.push([from, to]);
      return { data: rows.slice(from, Math.min(to + 1, from + cap)), count: options?.count ? total : null, error: null };
    } };
    return query;
  } }; } } as unknown as SupabaseClient<Database>;
  return { client, ranges };
}

it("reads every page, the rest side by side after the first", async () => {
  const { client, ranges } = fakeClient(2500, 1000);
  expect(await fetchAllAiCalls(client)).toHaveLength(2500);
  expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
});

it("pages at the API cap when it is smaller than asked", async () => {
  const { client, ranges } = fakeClient(1203, 500);
  const rows = await fetchAllAiCalls(client);
  expect(rows.map((row) => row.id)).toEqual(Array.from({ length: 1203 }, (_, index) => String(index)));
  expect(ranges).toEqual([[0, 999], [500, 999], [1000, 1499]]);
});

it("needs one request when everything fits", async () => {
  const { client, ranges } = fakeClient(40, 1000);
  expect(await fetchAllAiCalls(client)).toHaveLength(40);
  expect(ranges).toEqual([[0, 999]]);
});
