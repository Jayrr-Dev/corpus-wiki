import { afterEach, expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import { recoverOneUpload } from "./recovery";
import { processingCancellation } from "./cancellation";
afterEach(() => vi.useRealTimers());
it("yields before the execution deadline and releases the dispatch only after its work settles", async () => {
  vi.useFakeTimers();
  const calls: string[] = [];
  const db: DbRpc = { async call<T>(name: string) {
    calls.push(name);
    return (name === "claim_upload_recovery" ? { eventId: "event", token: "owner" } : true) as T;
  } };
  const run = vi.fn(async () => {
    const signal = processingCancellation.getStore()!;
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  const running = recoverOneUpload(db, run, 100);
  await vi.advanceTimersByTimeAsync(99);
  expect(calls).toEqual(["claim_upload_recovery"]);
  await vi.advanceTimersByTimeAsync(1);
  expect(await running).toBe(true);
  expect(calls).toEqual(["claim_upload_recovery", "finish_upload_recovery"]);
  expect(run).toHaveBeenCalledExactlyOnceWith("event");
});
it("does not start a pipeline when the durable queue has no eligible work", async () => {
  const db: DbRpc = { async call<T>() { return null as T; } };
  const run = vi.fn();
  expect(await recoverOneUpload(db, run)).toBe(false);
  expect(run).not.toHaveBeenCalled();
});
