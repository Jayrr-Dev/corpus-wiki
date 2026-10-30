import { afterEach, describe, expect, it, vi } from "vitest";
import { leaseHeartbeat } from "./leaseHeartbeat";

describe("leaseHeartbeat", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("reports a lost lease while it still holds one", async () => {
    vi.useFakeTimers();
    const lost = vi.fn();
    const heartbeat = leaseHeartbeat(() => Promise.reject(new Error("gone")), lost, 5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lost).toHaveBeenCalledTimes(1);
    heartbeat.release();
  });

  it("stops renewing once released, so an article can go on writing", async () => {
    vi.useFakeTimers();
    const renew = vi.fn(() => Promise.reject(new Error("gone")));
    const lost = vi.fn();
    leaseHeartbeat(renew, lost, 5_000).release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(renew).not.toHaveBeenCalled();
    expect(lost).not.toHaveBeenCalled();
  });

  it("ignores a renewal already on its way when the lease is released", async () => {
    vi.useFakeTimers();
    let answer: (failure: Error) => void = () => undefined;
    const lost = vi.fn();
    const heartbeat = leaseHeartbeat(() => new Promise((_, reject) => { answer = reject; }), lost, 5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    heartbeat.release();
    answer(new Error("gone"));
    await vi.advanceTimersByTimeAsync(0);
    expect(lost).not.toHaveBeenCalled();
  });
});
