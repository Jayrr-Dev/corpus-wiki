import { expect, it } from "vitest";
import { forEachLookahead } from "./lookahead";

it("overlaps independent reads but consumes them in document order", async () => {
  let active = 0, peak = 0;
  const accepted: number[] = [];
  await forEachLookahead([0, 1, 2, 3], {
    context: () => "unchanged",
    read: async (item) => { active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return { value: item }; },
    consume: async (_item, value) => { accepted.push(value); },
  });
  expect(peak).toBe(2);
  expect(accepted).toEqual([0, 1, 2, 3]);
});

it("rereads with the exact earlier composite context before accepting a continuation", async () => {
  let context = "";
  const accepted: string[] = [];
  const reads: string[] = [];
  await forEachLookahead([0, 1], {
    context: () => context,
    read: async (item, prior) => { reads.push(`${item}:${prior}`); return { value: `${item}:${prior}` }; },
    consume: async (item, value) => { accepted.push(value); if (item === 0) context = "procedure-started"; },
  });
  expect(reads).toEqual(["0:", "1:", "1:procedure-started"]);
  expect(accepted).toEqual(["0:", "1:procedure-started"]);
});

it("aborts and drains speculative work when consumption fails", async () => {
  let drained = false;
  await expect(forEachLookahead([0, 1], {
    context: () => "",
    read: async (item, _context, signal) => {
      if (item === 0) return { value: item };
      await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => { drained = true; reject(signal.reason); }, { once: true }));
      return { value: item };
    },
    consume: async () => { throw new Error("Stop"); },
  })).rejects.toThrow("Stop");
  expect(drained).toBe(true);
});
