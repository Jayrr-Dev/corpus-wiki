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

it("slows its refreshes while disconnected and returns to full speed after reconnecting", () => {
  const refresh = vi.fn();
  const fallback = subscriptionFallback(refresh);
  // The gap doubles after each refresh: 5s, 10s, 20s, 40s, then a minute at most
  for (const [gap, count] of [[5000, 1], [10_000, 2], [20_000, 3], [40_000, 4], [60_000, 5], [60_000, 6]] as const) {
    vi.advanceTimersByTime(gap - 1);
    expect(refresh).toHaveBeenCalledTimes(count - 1);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(count);
  }
  fallback.status("CLOSED");
  fallback.status("SUBSCRIBED");
  expect(refresh).toHaveBeenCalledTimes(7); // Catch-up refresh on reconnect
  fallback.status("CLOSED");
  vi.advanceTimersByTime(5000);
  expect(refresh).toHaveBeenCalledTimes(8); // A new disconnect starts at the 5s pace again
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
