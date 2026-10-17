import { afterEach, expect, it, vi } from "vitest";
import { AiInactivityError, withAiActivity } from "./inactivityTimeout";

afterEach(() => vi.useRealTimers());

it("aborts a silent provider after 60 seconds even if it ignores cancellation", async () => {
  vi.useFakeTimers();
  let signal!: AbortSignal;
  const result = withAiActivity((received) => { signal = received; return new Promise(() => {}); });
  const rejected = expect(result).rejects.toBeInstanceOf(AiInactivityError);
  await vi.advanceTimersByTimeAsync(60_000);
  await rejected;
  expect(signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("resets the deadline on output and clears it when the answer finishes", async () => {
  vi.useFakeTimers();
  let activity!: () => void;
  let finish!: (answer: string) => void;
  let signal!: AbortSignal;
  const result = withAiActivity((received, tick) => { signal = received; activity = tick; return new Promise<string>((resolve) => { finish = resolve; }); });
  await vi.advanceTimersByTimeAsync(45_000);
  activity();
  await vi.advanceTimersByTimeAsync(45_000);
  expect(signal.aborted).toBe(false);
  finish("complete");
  expect(await result).toBe("complete");
  expect(vi.getTimerCount()).toBe(0);
});
