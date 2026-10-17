import { afterEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS, embedderFromEnv } from "./embeddings";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import type { DbRpc } from "@/lib/db/rpc";

afterEach(() => vi.unstubAllGlobals());
const vector = (first = 1) => [first, ...Array<number>(EMBEDDING_DIMENSIONS - 1).fill(0)];
function respond(data: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data }) }));
  return embedderFromEnv({ NODE_ENV: "test", NEBIUS_API_KEY: "test" })!;
}

describe("embedding response validation", () => {
  it("overlaps two requests, preserves chunk ordering, and aborts queued work", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const abort = new AbortController();
    let active = 0, peak = 0;
    const fetch = vi.fn(async (_url, init: RequestInit) => {
      peak = Math.max(peak, ++active);
      await blocked;
      init.signal?.throwIfAborted();
      active--;
      const texts = JSON.parse(String(init.body)).input as string[];
      return new Response(JSON.stringify({ data: texts.map((text, index) => ({ index, embedding: vector(Number(text) + 1) })) }));
    });
    vi.stubGlobal("fetch", fetch);
    const embedder = embedderFromEnv({ NODE_ENV: "test", NEBIUS_API_KEY: "test" })!;
    const texts = Array.from({ length: 130 }, (_, index) => String(index));
    const running = embedder.embed(texts);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    release();
    expect((await running).map((row) => row[0])).toEqual(texts.map((text) => Number(text) + 1));
    expect(peak).toBe(2);
    abort.abort(new Error("Cancelled"));
    const db = {} as DbRpc;
    await expect(uploadExecution.run({ eventId: "event", token: "token", db, signal: abort.signal }, () => embedder.embed(texts))).rejects.toThrow("Cancelled");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("matches out-of-order vectors to their original inputs", async () => {
    const embedder = respond([{ index: 1, embedding: vector(2) }, { index: 0, embedding: vector() }]);
    expect(await embedder.embed(["first", "second"])).toEqual([vector(), vector(2)]);
  });
  it("rejects duplicate indices instead of attaching a vector to the wrong claim", async () => {
    const embedder = respond([{ index: 0, embedding: vector() }, { index: 0, embedding: vector(2) }]);
    await expect(embedder.embed(["first", "second"])).rejects.toThrow("invalid embeddings");
  });
  it.each([vector(0), vector(NaN), vector(Infinity), [1, 2]])("rejects an unusable vector %#", async (values) => {
    const embedder = respond([{ index: 0, embedding: values }]);
    await expect(embedder.embed(["claim"])).rejects.toThrow("invalid embeddings");
  });
});
