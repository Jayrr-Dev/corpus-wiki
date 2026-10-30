import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { steadyRefresh } from "./steadyRefresh";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("refreshes on a steady timer while shown and stops once disposed", () => {
  const refresh = vi.fn();
  const poll = steadyRefresh(refresh, () => true, 10_000);
  vi.advanceTimersByTime(9_999);
  expect(refresh).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  vi.advanceTimersByTime(10_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  poll.dispose();
  vi.advanceTimersByTime(60_000);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("never refreshes a hidden tab", () => {
  const refresh = vi.fn();
  const poll = steadyRefresh(refresh, () => false, 10_000);
  vi.advanceTimersByTime(60_000);
  expect(refresh).not.toHaveBeenCalled();
  poll.dispose();
});
