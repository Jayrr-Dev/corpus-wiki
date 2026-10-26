import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import type { ServerSupabase } from "@/lib/supabase/server";
import { ARM_CAP, RERANK_DEPTH, rankUnits, searchMode } from "./rank";

const mocks = vi.hoisted(() => ({ similarUnits: vi.fn(), savedVectors: vi.fn() }));
vi.mock("@/lib/knowledge/embeddingStore", () => ({ similarUnits: mocks.similarUnits, savedVectors: mocks.savedVectors }));

type Row = Record<string, unknown>;
// Units u-<id> with current revision r-<id>; `.or()` word filters match every row
function fakeClient(ids: string[]) {
  const tables: Record<string, Row[]> = {
    units: ids.map(id => ({ id, current_revision_id: `r-${id}`, retired_at: null })),
    revisions: ids.map(id => ({ id: `r-${id}`, unit_id: id, title: id, content: `text ${id}` })),
  };
  return { from(table: string) {
    const filters: ((row: Row) => boolean)[] = [];
    let limit = Infinity;
    const builder = {
      select() { return builder; },
      or() { return builder; },
      in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return builder; },
      is(key: string, value: unknown) { filters.push(row => (row[key] ?? null) === value); return builder; },
      limit(value: number) { limit = value; return builder; },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve(resolve({ data: (tables[table] ?? []).filter(row => filters.every(filter => filter(row))).slice(0, limit), error: null }));
      },
    };
    return builder;
  } } as unknown as ServerSupabase;
}

const rpc = { scope: vi.fn(), searchText: vi.fn(), linked: vi.fn() };
const db: DbRpc = { async call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (name === "living_page_query_units") return await rpc.scope(args) as T;
  if (name === "search_units_text") return await rpc.searchText(args) as T;
  if (name === "linked_units") return await rpc.linked(args) as T;
  throw new Error(`Unexpected database RPC ${name}`);
} };
const embedder = { model: "test", embed: vi.fn(async () => [[1, 0]]) };
const matches = (ids: string[]) => ids.map(id => ({ unitId: id, revisionId: `r-${id}`, content: id, similarity: 0.9 }));
const textRows = (ids: string[]) => ids.map((id, index) => ({ unit_id: id, revision_id: `r-${id}`, rank: 1 / (index + 1) }));
const entity = { type: "company", key: "utilitek" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  embedder.embed.mockResolvedValue([[1, 0]]);
  mocks.similarUnits.mockResolvedValue([]);
  mocks.savedVectors.mockResolvedValue(new Map());
  rpc.scope.mockResolvedValue([]);
  rpc.searchText.mockResolvedValue([]);
  rpc.linked.mockResolvedValue([]);
});

describe("searchMode", () => {
  it("is legacy unless CHAT_SEARCH is hybrid", () => {
    expect(searchMode({ NODE_ENV: "test" })).toBe("legacy");
    expect(searchMode({ NODE_ENV: "test", CHAT_SEARCH: "hybrid" })).toBe("hybrid");
    expect(searchMode({ NODE_ENV: "test", CHAT_SEARCH: "other" })).toBe("legacy");
  });

  it("reads the mode from the environment when none is given", async () => {
    vi.stubEnv("CHAT_SEARCH", "hybrid");
    const result = await rankUnits("lockout", { db, client: fakeClient([]), embedder });
    expect(result.mode).toBe("hybrid");
    expect(rpc.searchText).toHaveBeenCalled();
  });
});

describe("rankUnits legacy", () => {
  it("keeps the old order: scoped meaning, scoped words, then meaning, then words", async () => {
    const client = fakeClient(["s1", "s2", "m1", "w1"]);
    rpc.scope.mockResolvedValue(["s1", "s2"]);
    mocks.savedVectors.mockResolvedValue(new Map([["r-s2", [1, 0]], ["r-s1", [0.6, 0.8]]]));
    mocks.similarUnits.mockResolvedValue(matches(["m1", "s1"]));
    const result = await rankUnits("lockout steps", { db, client, embedder, entity, mode: "legacy" });
    // s2 is closer than s1; scoped words list s1, s2 again; words list every revision
    expect(result.unitIds).toEqual(["s2", "s1", "m1", "w1"]);
    expect(result.arms).toEqual({ meaning: ["m1", "s1"], words: ["s1", "s2", "m1", "w1"], scopedMeaning: ["s2", "s1"], scopedWords: ["s1", "s2"] });
    expect(mocks.similarUnits).toHaveBeenCalledWith(db, "test", [1, 0], 12, 0.35);
    expect(rpc.searchText).not.toHaveBeenCalled();
    expect(rpc.linked).not.toHaveBeenCalled();
  });
});

describe("rankUnits hybrid", () => {
  it("fuses the arms so agreement beats one arm's top pick", async () => {
    mocks.similarUnits.mockResolvedValue(matches(["a", "b", "c"]));
    rpc.searchText.mockResolvedValue(textRows(["d", "b"]));
    rpc.linked.mockResolvedValue([{ unit_id: "e", via_unit_id: "a", type: "supports" }, { unit_id: "b", via_unit_id: "d", type: "supports" }]);
    const result = await rankUnits("lockout", { db, client: fakeClient([]), embedder, mode: "hybrid" });
    expect(result.unitIds[0]).toBe("b");
    expect(result.unitIds).toEqual(expect.arrayContaining(["a", "c", "d", "e"]));
    expect(result.arms).toMatchObject({ meaning: ["a", "b", "c"], keyword: ["d", "b"], link: ["e", "b"] });
    expect(mocks.similarUnits).toHaveBeenCalledWith(db, "test", [1, 0], ARM_CAP, 0.35);
    expect(rpc.searchText).toHaveBeenCalledWith({ p_query: "lockout", p_limit: ARM_CAP });
  });

  it("seeds the link arm from the top 5 meaning and top 5 keyword matches", async () => {
    mocks.similarUnits.mockResolvedValue(matches(["m1", "m2", "m3", "m4", "m5", "m6"]));
    rpc.searchText.mockResolvedValue(textRows(["k1", "m1", "k2", "k3", "k4", "k5"]));
    await rankUnits("lockout", { db, client: fakeClient([]), embedder, mode: "hybrid" });
    expect(rpc.linked).toHaveBeenCalledWith({ p_unit_ids: ["m1", "m2", "m3", "m4", "m5", "k1", "k2", "k3", "k4"], p_limit: ARM_CAP });
  });

  it("caps each arm before fusing", async () => {
    const many = Array.from({ length: 30 }, (_, index) => `k${index}`);
    rpc.searchText.mockResolvedValue(textRows(many));
    const result = await rankUnits("lockout", { db, client: fakeClient([]), embedder, mode: "hybrid" });
    expect(result.unitIds).toEqual(many.slice(0, ARM_CAP));
  });

  it("weights the selected entity's own arms above global matches", async () => {
    rpc.scope.mockResolvedValue(["s1"]);
    mocks.savedVectors.mockResolvedValue(new Map([["r-s1", [1, 0]]]));
    mocks.similarUnits.mockResolvedValue(matches(["g1"]));
    rpc.searchText.mockResolvedValue(textRows(["g2"]));
    const result = await rankUnits("lockout", { db, client: fakeClient(["s1"]), embedder, entity, mode: "hybrid" });
    expect(result.unitIds[0]).toBe("s1");
    expect(result.arms).toMatchObject({ scopedMeaning: ["s1"], scopedWords: ["s1"] });
  });

  it("keeps the other arms when keyword or link search fails", async () => {
    mocks.similarUnits.mockResolvedValue(matches(["a"]));
    rpc.searchText.mockRejectedValue(new Error("missing function"));
    rpc.linked.mockResolvedValue([{ unit_id: "e", via_unit_id: "a", type: "supports" }]);
    const keywordDown = await rankUnits("lockout", { db, client: fakeClient([]), embedder, mode: "hybrid" });
    expect(keywordDown.unitIds).toEqual(["a", "e"]);
    expect(keywordDown.warning).toContain("Keyword search");

    rpc.searchText.mockResolvedValue(textRows(["d"]));
    rpc.linked.mockRejectedValue(new Error("missing function"));
    const linkDown = await rankUnits("lockout", { db, client: fakeClient([]), embedder, mode: "hybrid" });
    expect(linkDown.unitIds).toEqual(["a", "d"]);
    expect(linkDown.warning).toContain("Linked claims");
  });

  it("uses keyword and link search when there is no vector", async () => {
    rpc.searchText.mockResolvedValue(textRows(["d"]));
    rpc.linked.mockResolvedValue([{ unit_id: "e", via_unit_id: "d", type: "supports" }]);
    const result = await rankUnits("lockout", { db, client: fakeClient([]), embedder, vector: null, mode: "hybrid" });
    expect(embedder.embed).not.toHaveBeenCalled();
    expect(mocks.similarUnits).not.toHaveBeenCalled();
    expect(result.unitIds).toEqual(["d", "e"]);
    expect(rpc.linked).toHaveBeenCalledWith({ p_unit_ids: ["d"], p_limit: ARM_CAP });
  });

  it("embeds the question itself when no vector is given, and warns when that fails", async () => {
    embedder.embed.mockRejectedValueOnce(new Error("offline"));
    const result = await rankUnits("lockout", { db, client: fakeClient([]), embedder, mode: "hybrid" });
    expect(result.warning).toContain("text matches only");
    expect(mocks.similarUnits).not.toHaveBeenCalled();
  });
});

describe("rankUnits rerank", () => {
  const ids = (prefix: string) => Array.from({ length: ARM_CAP }, (_, index) => `${prefix}${index}`);
  const reversing = (model = "rerank-test") => ({ model, rerank: vi.fn(async (_query: string, documents: string[]) => documents.map((_, index) => documents.length - 1 - index)) });
  async function fusedOrder() {
    return (await rankUnits("lockout", { db, client: fakeClient([]), embedder, mode: "hybrid", reranker: null })).unitIds;
  }
  beforeEach(() => {
    mocks.similarUnits.mockResolvedValue(matches(ids("m")));
    rpc.searchText.mockResolvedValue(textRows(ids("k")));
    rpc.linked.mockResolvedValue(ids("l").map(id => ({ unit_id: id, via_unit_id: "m0", type: "supports" })));
  });

  it("re-sorts the fused top 40 by title and content and leaves the rest in place", async () => {
    const fused = await fusedOrder();
    expect(fused).toHaveLength(60);
    const reranker = reversing();
    const result = await rankUnits("lockout", { db, client: fakeClient([...ids("m"), ...ids("k"), ...ids("l")]), embedder, mode: "hybrid", reranker });
    expect(result.unitIds).toEqual([...fused.slice(0, RERANK_DEPTH).reverse(), ...fused.slice(RERANK_DEPTH)]);
    expect(result.arms.reranked).toEqual(fused.slice(0, RERANK_DEPTH).reverse());
    expect(result.rerankedBy).toBe("rerank-test");
    expect(reranker.rerank).toHaveBeenCalledWith("lockout", fused.slice(0, RERANK_DEPTH).map(id => `${id}\ntext ${id}`));
  });

  it("puts claims whose text cannot be read after the reranked ones", async () => {
    const fused = await fusedOrder();
    const readable = fused.slice(0, RERANK_DEPTH).filter(id => id.startsWith("k"));
    const result = await rankUnits("lockout", { db, client: fakeClient(readable), embedder, mode: "hybrid", reranker: reversing() });
    expect(result.unitIds.slice(0, readable.length)).toEqual([...readable].reverse());
    expect(result.unitIds.slice(readable.length, RERANK_DEPTH)).toEqual(fused.slice(0, RERANK_DEPTH).filter(id => !id.startsWith("k")));
  });

  it.each([
    ["the request fails", async () => { throw new Error("timeout"); }],
    ["the ranking repeats an index", async (_query: string, documents: string[]) => documents.map(() => 0)],
    ["the ranking is short", async () => [0]],
  ])("falls back to the legacy order without a warning when %s", async (_label, rerank) => {
    // Word matches cover every row the client holds, k first, capped at 20
    const client = fakeClient([...ids("k"), ...ids("m")]);
    const result = await rankUnits("lockout", { db, client, embedder, mode: "hybrid", reranker: { model: "rerank-test", rerank } });
    // Legacy: top 12 by meaning, then the word matches
    expect(result.unitIds).toEqual([...ids("m").slice(0, 12), ...ids("k")]);
    expect(result.unitIds).not.toEqual(await fusedOrder());
    expect(result.rerankedBy).toBeNull();
    expect(result.arms).toMatchObject({ meaning: ids("m"), keyword: ids("k"), link: ids("l"), words: ids("k") });
    expect(result.arms.reranked).toBeUndefined();
    expect(result.warning).toBeNull();
  });

  it("falls back to legacy with the entity's claims first", async () => {
    rpc.scope.mockResolvedValue(["s1"]);
    mocks.savedVectors.mockResolvedValue(new Map([["r-s1", [1, 0]]]));
    const result = await rankUnits("lockout", { db, client: fakeClient(["s1"]), embedder, entity, mode: "hybrid", reranker: { model: "rerank-test", rerank: async () => { throw new Error("timeout"); } } });
    expect(result.unitIds).toEqual(["s1", ...ids("m").slice(0, 12)]);
  });

  it("keeps the fused order when no reranker is configured", async () => {
    const result = await rankUnits("lockout", { db, client: fakeClient(ids("k")), embedder, mode: "hybrid", reranker: null });
    expect(result.unitIds).toEqual(await fusedOrder());
    expect(result.arms.words).toBeUndefined();
  });

  it("never reranks in legacy mode", async () => {
    const reranker = reversing();
    const result = await rankUnits("lockout", { db, client: fakeClient(ids("m")), embedder, mode: "legacy", reranker });
    expect(reranker.rerank).not.toHaveBeenCalled();
    expect(result.rerankedBy).toBeNull();
  });
});
