import { expect, it, vi } from "vitest";
import { readIdBatches, readPages } from "./batched";

it("bounds book-sized ID filters, removes repeated inputs and preserves order", async () => {
  const ids = Array.from({ length: 1402 }, (_, i) => `id-${i}`);
  const read = vi.fn(async (batch: string[]) => batch);
  expect(await readIdBatches([...ids, ids[0]!], read)).toEqual(ids);
  expect(read).toHaveBeenCalledTimes(15);
  expect(read.mock.calls.every(([batch]) => batch.length <= 100)).toBe(true);
  expect(await readIdBatches([], read)).toEqual([]);
});

it("keeps reading beyond the API row cap and propagates later-page failures", async () => {
  const rows = Array.from({ length: 1402 }, (_, i) => i);
  expect(await readPages(async (from, to) => ({ data: rows.slice(from, to + 1), error: null }))).toEqual(rows);
  await expect(readPages(async (from) => from === 0
    ? { data: rows.slice(0, 500), error: null }
    : { data: null, error: new Error("Read failed") })).rejects.toThrow("Read failed");
});
