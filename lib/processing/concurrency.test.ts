import { afterEach, expect, it, vi } from "vitest";
import { mapConcurrent, RequestPool } from "./concurrency";
import { fetchWithRetry } from "./requests";
import { processingMetric, processingSpan, withProcessingReport, type ProcessingReport } from "./metrics";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function gate() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

it("shares a FIFO request budget, removes aborted waiters, and releases failed slots", async () => {
  const pool = new RequestPool(1);
  const release = gate();
  const first = pool.run(() => release.promise);
  const abort = new AbortController();
  const cancelled = pool.run(async () => { throw new Error("Should not start"); }, abort.signal);
  const rejected = expect(cancelled).rejects.toThrow("Cancelled");
  const started: string[] = [];
  const later = pool.run(async () => { started.push("next"); throw new Error("Failed"); });
  const failed = expect(later).rejects.toThrow("Failed");
  abort.abort(new Error("Cancelled"));
  await rejected;
  expect(started).toEqual([]);
  release.resolve();
  await first;
  await failed;
  expect(started).toEqual(["next"]);
  expect(await pool.run(async () => "recovered")).toBe("recovered");
});

it("preserves result order and drains active work before returning a map failure", async () => {
  const release = gate();
  const starts: number[] = [];
  let settled = false;
  const running = mapConcurrent([0, 1, 2, 3], 2, async (value) => {
    starts.push(value);
    if (value === 0) throw new Error("Failed");
    await release.promise;
    return value;
  }).finally(() => { settled = true; });
  const failed = expect(running).rejects.toThrow("Failed");
  await Promise.resolve(); await Promise.resolve();
  expect(starts).toEqual([0, 1]);
  expect(settled).toBe(false);
  release.resolve();
  await failed;
  expect(await mapConcurrent([2, 1, 0], 2, async (value) => value * 2)).toEqual([4, 2, 0]);
});

it("cancels provider backoff without another request and does not retry a validation response", async () => {
  vi.useFakeTimers();
  const abort = new AbortController();
  const fetch = vi.fn(async () => new Response("busy", { status: 429, headers: { "retry-after": "10" } }));
  vi.stubGlobal("fetch", fetch);
  const running = fetchWithRetry("https://example.test", { signal: abort.signal });
  const failed = expect(running).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(1);
  abort.abort(new Error("Cancelled"));
  await failed;
  expect(fetch).toHaveBeenCalledOnce();
  fetch.mockResolvedValue(new Response("invalid", { status: 422 }));
  expect((await fetchWithRetry("https://example.test", {})).status).toBe(422);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("keeps simultaneous run metrics separate and reporting failures cannot fail processing", async () => {
  const reports: ProcessingReport[] = [];
  await Promise.all(["one", "two"].map((event) => withProcessingReport(event, "test", async () => {
    await processingSpan("stage.test", async () => { processingMetric("ai.test", 12, { tokensIn: 7 }); });
  }, (report) => { reports.push(report); })));
  expect(reports.map((report) => report.eventId).sort()).toEqual(["one", "two"]);
  for (const report of reports) expect(report.metrics["ai.test"]).toMatchObject({ count: 1, tokensIn: 7, durationMs: 12 });
  expect(await withProcessingReport("x", "test", async () => 42, () => { throw new Error("Sink offline"); })).toBe(42);
});
it("reports a caught pipeline failure using its returned outcome", async () => {
  const reports: ProcessingReport[] = [];
  await withProcessingReport("x", "test", async () => ({ error: "Writer failed" }), (report) => reports.push(report), (value) => value.error ? "failed" : "succeeded");
  expect(reports[0]).toMatchObject({ status: "failed", startedAt: expect.any(String), finishedAt: expect.any(String) });
});
