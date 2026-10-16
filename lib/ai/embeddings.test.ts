import { afterEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS, embedderFromEnv } from "./embeddings";

afterEach(() => vi.unstubAllGlobals());
const vector = (first = 1) => [first, ...Array<number>(EMBEDDING_DIMENSIONS - 1).fill(0)];
function respond(data: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data }) }));
  return embedderFromEnv({ NODE_ENV: "test", NEBIUS_API_KEY: "test" })!;
}

describe("embedding response validation", () => {
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
