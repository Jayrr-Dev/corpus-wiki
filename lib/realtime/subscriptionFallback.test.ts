import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { subscriptionFallback } from "./subscriptionFallback";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("refreshes saved data while connection is unavailable and stops polling when healthy", () => {
  const refresh = vi.fn();
  const fallback = subscriptionFallback(refresh);
  vi.advanceTimersByTime(5000);
  expect(refresh).toHaveBeenCalledTimes(1);
  fallback.status("SUBSCRIBED");
  vi.advanceTimersByTime(20_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  fallback.status("CHANNEL_ERROR");
  fallback.status("TIMED_OUT");
  vi.advanceTimersByTime(5000);
  expect(refresh).toHaveBeenCalledTimes(2); // Multiple errors never multiply timers.
  fallback.status("SUBSCRIBED");
  expect(refresh).toHaveBeenCalledTimes(3); // Catch changes missed during reconnect.
  fallback.status("SUBSCRIBED");
  vi.advanceTimersByTime(20_000);
  expect(refresh).toHaveBeenCalledTimes(3);
  fallback.dispose();
});

it("avoids background-tab polling and never restarts a disposed subscription", () => {
  let visible = false;
  const refresh = vi.fn();
  const fallback = subscriptionFallback(refresh, () => visible);
  fallback.status("CLOSED");
  vi.advanceTimersByTime(15_000);
  expect(refresh).not.toHaveBeenCalled();
  visible = true;
  vi.advanceTimersByTime(5000);
  expect(refresh).toHaveBeenCalledTimes(1);
  fallback.dispose();
  fallback.status("CLOSED");
  fallback.status("SUBSCRIBED");
  vi.advanceTimersByTime(15_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
