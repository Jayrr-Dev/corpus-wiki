import { mapConcurrent } from "@/lib/processing/concurrency";

// Preserve input order, stop scheduling on failure, and drain active calls before returning.
export async function reviewMap<T, R>(items: readonly T[], run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  return mapConcurrent(items, 3, run);
}
