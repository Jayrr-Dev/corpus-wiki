import { afterEach, expect, it, vi } from "vitest";
import { fetchDatabaseRead } from "./readFetch";

afterEach(() => vi.useRealTimers());
const url = "https://example.test/rest/v1/units";
const empty = () => new Response(JSON.stringify({ code: "", message: "", details: null, hint: null }), { status: 400 });

it("retries interrupted reads through database recovery without changing their filters or headers", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValueOnce(empty()).mockResolvedValueOnce(new Response("recovering", { status: 503 }))
    .mockResolvedValueOnce(new Response('[{"id":"saved"}]'));
  const init = { headers: { "x-via": "script" } };
  const running = fetchDatabaseRead(`${url}?id=eq.saved`, init, fetcher);
  await vi.runAllTimersAsync();
  expect(await (await running).json()).toEqual([{ id: "saved" }]);
  expect(fetcher.mock.calls).toEqual(Array.from({ length: 3 }, () => [`${url}?id=eq.saved`, init]));
});

it("does not replay writes or a real query rejection", async () => {
  const fetcher = vi.fn().mockImplementation(async () => empty());
  expect((await fetchDatabaseRead(url, { method: "POST", body: "write" }, fetcher)).status).toBe(400);
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ code: "42703", message: "Unknown column" }), { status: 400 }));
  expect((await fetchDatabaseRead(url, {}, fetcher)).status).toBe(400);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("stops retrying immediately when the read is cancelled", async () => {
  vi.useFakeTimers();
  const abort = new AbortController();
  const fetcher = vi.fn().mockImplementation(async () => empty());
  const running = fetchDatabaseRead(url, { signal: abort.signal }, fetcher);
  const failed = expect(running).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(1);
  abort.abort(new Error("Cancelled"));
  await failed;
  expect(fetcher).toHaveBeenCalledOnce();
});

it("honors cancellation carried by a Request while waiting for recovery", async () => {
  const abort = new AbortController();
  const fetcher = vi.fn().mockImplementation(async () => { abort.abort(new Error("Request cancelled")); throw new TypeError("fetch failed"); });
  await expect(fetchDatabaseRead(new Request(url, { signal: abort.signal }), {}, fetcher)).rejects.toThrow("Request cancelled");
  expect(fetcher).toHaveBeenCalledOnce();
});

it("gives a useful error after bounded retries instead of returning a blank message", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockImplementation(async () => empty());
  const running = fetchDatabaseRead(url, {}, fetcher);
  const failed = expect(running).rejects.toThrow("completed work is saved");
  await vi.runAllTimersAsync();
  await failed;
  expect(fetcher).toHaveBeenCalledTimes(8);
});
