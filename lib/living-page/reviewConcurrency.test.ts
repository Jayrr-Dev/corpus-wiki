import { expect, it } from "vitest";
import { reviewMap } from "./reviewConcurrency";

it("runs at most three calls and preserves order", async () => {
  let active = 0;
  let peak = 0;
  const result = await reviewMap([0, 1, 2, 3, 4, 5], async (value) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return value;
  });
  expect(peak).toBe(3);
  expect(active).toBe(0);
  expect(result).toEqual([0, 1, 2, 3, 4, 5]);
});

it("drains in-flight calls and stops scheduling after failure", async () => {
  let active = 0;
  const started: number[] = [];
  await expect(reviewMap([0, 1, 2, 3, 4], async (value) => {
    started.push(value);
    if (value === 0) throw new Error("failed");
    active++;
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    return value;
  })).rejects.toThrow("failed");
  expect(active).toBe(0);
  expect(started).toEqual([0, 1, 2]);
});
