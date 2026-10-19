import { mapConcurrent } from "@/lib/processing/concurrency";

// Keep UUID filters below proxy URL limits, and read beyond PostgREST's row cap.
export const FILTER_BATCH_SIZE = 100;
const PAGE_SIZE = 500;
type Page<T> = { data: T[] | null; error: { message: string } | null };

export async function readPages<T>(read: (from: number, to: number) => PromiseLike<Page<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await read(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export async function readIdBatches<T>(ids: readonly string[], read: (batch: string[]) => Promise<T[]>): Promise<T[]> {
  const unique = [...new Set(ids)];
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += FILTER_BATCH_SIZE) batches.push(unique.slice(i, i + FILTER_BATCH_SIZE));
  return (await mapConcurrent(batches, 3, read)).flat();
}
