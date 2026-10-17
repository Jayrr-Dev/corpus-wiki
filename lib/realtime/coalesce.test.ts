import { afterEach, expect, it, vi } from "vitest";
import { coalesceInvalidation } from "./coalesce";
afterEach(() => vi.useRealTimers());
it("combines subscriber bursts, flushes sustained updates, and cleans up the last subscriber", async () => {
  vi.useFakeTimers();
  const owner = {};
  const invalidate = vi.fn();
  const first = coalesceInvalidation(owner, "lines", invalidate);
  const second = coalesceInvalidation(owner, "lines", invalidate);
  for (let index = 0; index < 100; index++) { first.trigger(); second.trigger(); }
  await vi.advanceTimersByTimeAsync(250);
  expect(invalidate).toHaveBeenCalledOnce();
  first.dispose();
  second.trigger();
  await vi.advanceTimersByTimeAsync(250);
  expect(invalidate).toHaveBeenCalledTimes(2);
  second.trigger(); second.dispose();
  await vi.advanceTimersByTimeAsync(250);
  expect(invalidate).toHaveBeenCalledTimes(2);
});
