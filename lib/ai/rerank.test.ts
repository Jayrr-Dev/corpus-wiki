import { afterEach, describe, expect, it, vi } from "vitest";
import { getReranker, REQUEST_TIMEOUT_MS, VOYAGE_RERANK_URL } from "./rerank";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const ON = { NODE_ENV: "test", VOYAGE_API_KEY: "test-key" } as NodeJS.ProcessEnv;
function respond(body: unknown, status = 200) {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("getReranker", () => {
  it("is on whenever a key is set", () => {
    expect(getReranker(ON)).not.toBeNull();
  });
  it("is off without a key", () => {
    expect(getReranker({ NODE_ENV: "test" })).toBeNull();
    expect(getReranker({ ...ON, VOYAGE_API_KEY: "" })).toBeNull();
  });
  it("uses rerank-2.5 unless VOYAGE_RERANK_MODEL is set", () => {
    expect(getReranker(ON)!.model).toBe("rerank-2.5");
    expect(getReranker({ ...ON, VOYAGE_RERANK_MODEL: "rerank-2.5-lite" })!.model).toBe("rerank-2.5-lite");
  });
});

describe("rerank", () => {
  it("sends the query, documents, model and truncation with Bearer auth", async () => {
    const fetch = respond({ data: [{ index: 0, relevance_score: 0.5 }, { index: 1, relevance_score: 0.4 }] });
    await getReranker(ON)!.rerank("what is x?", ["first", "second"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(VOYAGE_RERANK_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer test-key", "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ query: "what is x?", documents: ["first", "second"], model: "rerank-2.5", truncation: true });
  });
  it("returns input indices best first, whatever order the response lists them in", async () => {
    respond({ data: [{ index: 0, relevance_score: 0.1 }, { index: 2, relevance_score: 0.9 }, { index: 1, relevance_score: 0.5 }] });
    expect(await getReranker(ON)!.rerank("q", ["a", "b", "c"])).toEqual([2, 1, 0]);
  });
  it("returns [] for no documents without calling Voyage", async () => {
    const fetch = respond({ data: [] });
    expect(await getReranker(ON)!.rerank("q", [])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("throws on a non-2xx response without echoing the key or documents", async () => {
    respond({ detail: "Invalid model" }, 400);
    const error = await getReranker(ON)!.rerank("q", ["secret claim"]).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Rerank request failed (400): Invalid model");
    expect((error as Error).message).not.toMatch(/test-key|secret claim/);
  });
  it("retries a transient failure at most once", async () => {
    const fetch = respond({ detail: "Busy" }, 503);
    await expect(getReranker(ON)!.rerank("q", ["a"])).rejects.toThrow("Rerank request failed (503)");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["a missing data array", {}],
    ["too few results", { data: [{ index: 0, relevance_score: 0.5 }] }],
    ["a duplicate index", { data: [{ index: 0, relevance_score: 0.5 }, { index: 0, relevance_score: 0.4 }] }],
    ["an index out of range", { data: [{ index: 0, relevance_score: 0.5 }, { index: 2, relevance_score: 0.4 }] }],
    ["a non-integer index", { data: [{ index: 0, relevance_score: 0.5 }, { index: 0.5, relevance_score: 0.4 }] }],
    ["a missing score", { data: [{ index: 0, relevance_score: 0.5 }, { index: 1 }] }],
  ])("throws on %s", async (_label, body) => {
    respond(body);
    await expect(getReranker(ON)!.rerank("q", ["a", "b"])).rejects.toThrow("invalid ranking");
  });
  it("gives up after the timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("The operation timed out.", "TimeoutError")), 10);
      return controller.signal;
    });
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
    })));
    await expect(getReranker(ON)!.rerank("q", ["a"])).rejects.toThrow("timed out");
    expect(timeout).toHaveBeenCalledWith(REQUEST_TIMEOUT_MS);
  });
  it("stops when the caller aborts", async () => {
    const fetch = respond({ data: [{ index: 0, relevance_score: 0.5 }] });
    const controller = new AbortController();
    controller.abort(new Error("Cancelled"));
    await expect(getReranker(ON)!.rerank("q", ["a"], controller.signal)).rejects.toThrow("Cancelled");
    expect(fetch).not.toHaveBeenCalled();
  });
});
