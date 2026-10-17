import { expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { emptyArticleCandidates } from "./emptyArticleCandidates";

const page = { id: "page", title: "Utility clearance standards", scope: "Minimum separation; excludes permit applications.", entity_id: null, context_entity_id: null };
function client(sections: { query: object }[] = []) {
  return { from: (table: string) => {
    const chain = { select: () => chain, eq: () => chain, is: () => chain, in: () => chain, limit: () => chain, single: () => chain,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: table === "entities" ? { type: "concept", key: "clearance" } : sections, error: null })) };
    return chain;
  } } as unknown as AdminSupabase;
}

it("uses the linked subject and descendant selections, ignoring empty unscoped queries", async () => {
  const call = vi.fn(async (_name: string, args: Record<string, unknown>) => {
    const query = args.p_query as { entity?: object };
    return query.entity ? ["subject"] : ["child", "subject"];
  });
  const result = await emptyArticleCandidates({ call } as DbRpc, client([{ query: {} }, { query: { unitIds: ["child"] } }]),
    { ...page, entity_id: "entity" }, [{ id: "page" }, { id: "child-page", parent_page_id: "page" }], null);
  expect(result).toEqual(["subject", "child"]);
  expect(call.mock.calls.map(([, args]) => args.p_query)).toEqual([{ entity: { type: "concept", key: "clearance" } }, { unitIds: ["child"] }]);
});

it("retrieves a bounded set by title and scope when a page has no entity or children", async () => {
  const call = vi.fn().mockResolvedValue([{ unit_id: "nearby", revision_id: "r", content: "Supported claim", similarity: 0.8 }]);
  const embedder = { model: "test", embed: vi.fn().mockResolvedValue([[0.1, 0.2]]) };
  expect(await emptyArticleCandidates({ call } as DbRpc, client(), page, [page], embedder)).toEqual(["nearby"]);
  expect(embedder.embed).toHaveBeenCalledWith([`${page.title}\n${page.scope}`]);
  expect(call).toHaveBeenCalledWith("similar_units", { p_embedding: "[0.1,0.2]", p_model: "test", p_limit: 40, p_min: 0.55 });
});

it("does not scan all knowledge or create scaffolding when no retrieval is available", async () => {
  const call = vi.fn();
  expect(await emptyArticleCandidates({ call } as DbRpc, client(), page, [page], null)).toEqual([]);
  expect(call).not.toHaveBeenCalled();
});

it("caps broad subject selections before discovery", async () => {
  const call = vi.fn().mockResolvedValue(Array.from({ length: 500 }, (_, index) => `u${index}`));
  const embedder = { model: "test", embed: vi.fn() };
  expect(await emptyArticleCandidates({ call } as DbRpc, client(), { ...page, entity_id: "entity" }, [page], embedder)).toHaveLength(300);
  expect(embedder.embed).not.toHaveBeenCalled();
});
