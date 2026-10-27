// =====================================================================
// WHOLE-TABLE READS at PostgREST's row cap (1,000 rows a page), so a
// table under that size comes back in one request. lib/queries reads
// 500 at a time, which turns a 600-row join table into two requests,
// one after the other. Pass an ordered query so pages never overlap.
// =====================================================================

const PAGE_SIZE = 1000;
type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

// Reads every page of one ordered query; throws the PostgREST error so TanStack Query shows it
export async function readAllPages<T>(readPage: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await readPage(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}
