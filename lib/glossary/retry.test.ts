import { expect, it, vi } from "vitest";
import { isGlossaryInterruption, retryGlossaryOperation } from "./retry";

const reset = "upstream connect error or disconnect/reset before headers. retried and the latest reset reason: connection termination";

it("recognizes connection interruptions, including wrapped failures", () => {
  for (const error of [new Error(reset), new Error("fetch failed"), { code: "08006" }, { code: "25P02" }, new Error("current transaction is aborted, commands ignored until end of transaction block"), new Error("unexpected NULL detoast result"), { status: 503 }, new Error("Comparisons failed", { cause: new Error(reset) })]) {
    expect(isGlossaryInterruption(error)).toBe(true);
  }
  for (const error of [new Error("Cancelled"), new Error("Another glossary generation took over"), new Error("Invalid citation"), { status: 401, message: reset }, { code: "42501", message: reset }]) {
    expect(isGlossaryInterruption(error)).toBe(false);
  }
});

it("recovers an interrupted operation and bounds retries during an outage", async () => {
  const run = vi.fn().mockRejectedValueOnce(new Error(reset)).mockResolvedValue("saved");
  expect(await retryGlossaryOperation(run, [0, 0])).toBe("saved");
  expect(run).toHaveBeenCalledTimes(2);
  const unavailable = vi.fn().mockRejectedValue(new Error(reset));
  await expect(retryGlossaryOperation(unavailable, [0, 0])).rejects.toThrow(reset);
  expect(unavailable).toHaveBeenCalledTimes(3);
});

it("does not retry invalid data, and stops a pending retry on cancellation", async () => {
  const invalid = vi.fn().mockRejectedValue(new Error("Invalid citation"));
  await expect(retryGlossaryOperation(invalid, [0])).rejects.toThrow("Invalid citation");
  expect(invalid).toHaveBeenCalledOnce();
  const abort = new AbortController();
  const interrupted = vi.fn().mockImplementation(async () => {
    abort.abort(new Error("Cancelled"));
    throw new Error(reset);
  });
  await expect(retryGlossaryOperation(interrupted, [10_000], abort.signal)).rejects.toThrow("Cancelled");
  expect(interrupted).toHaveBeenCalledOnce();
});

it("retries database deadlines but never explicit cancellation", async () => {
  expect(isGlossaryInterruption(new Error("publish_glossary_meanings: canceling statement due to statement timeout"))).toBe(true);
  expect(isGlossaryInterruption(Object.assign(new Error("canceling statement due to statement timeout"), { glossaryFinal: true }))).toBe(false);
  expect(isGlossaryInterruption(new Error("canceling statement due to user request"))).toBe(false);
  expect(isGlossaryInterruption(new DOMException("The operation was aborted due to timeout", "TimeoutError"))).toBe(true);
  expect(isGlossaryInterruption(new Error("TimeoutError: The operation was aborted due to timeout"))).toBe(true);
  expect(isGlossaryInterruption(new DOMException("Cancelled", "AbortError"))).toBe(false);
});

it("retries hosting gateway failures without treating authorization errors as temporary", () => {
  for (const status of [520, 521, 522, 523, 524, 525, 526]) expect(isGlossaryInterruption({ status, message: "Upstream hosting error" })).toBe(true);
  expect(isGlossaryInterruption({ status: 403, message: "Upstream hosting error" })).toBe(false);
});
