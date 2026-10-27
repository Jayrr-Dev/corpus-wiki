import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database/types";

// =====================================================================
// EVERY AI CALL, FAST: the first page comes back with the row count, then
// the other pages load side by side instead of one after another. Same
// rows and order as the shared list reader (newest first, id breaks ties).
// =====================================================================

type AiCall = Tables<"ai_calls">;

// Rows asked for per request; the API may cap pages lower, which the first page reveals
const PAGE_SIZE = 1000;

export async function fetchAllAiCalls(client: SupabaseClient<Database>): Promise<AiCall[]> {
  const page = (from: number, size: number, count = false) => client.from("ai_calls")
    .select("*", count ? { count: "exact" } : undefined)
    .order("created_at", { ascending: false }).order("id", { ascending: true })
    .range(from, from + size - 1);
  const first = await page(0, PAGE_SIZE, true);
  if (first.error) throw first.error;
  const rows = first.data ?? [];
  const total = first.count ?? rows.length;
  if (rows.length >= total || rows.length === 0) return rows;
  // A short first page below the count means the API cap is smaller than asked: page at that size
  const size = rows.length;
  const rest = await Promise.all(Array.from({ length: Math.ceil((total - size) / size) }, (_, index) => page(size * (index + 1), size)));
  for (const result of rest) {
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
  }
  // Rows written while the pages load shift the offsets, so a row can arrive twice
  const seen = new Set<string>();
  return rows.filter((row) => !seen.has(row.id) && Boolean(seen.add(row.id)));
}
