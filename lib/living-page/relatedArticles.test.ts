import { expect, it } from "vitest";
import { personalizedPageRank, rankRelatedArticles, type RelatedPage } from "./relatedArticles";

const page = (id: string, extra: Partial<RelatedPage> = {}): RelatedPage => ({ id, title: id, slug: id, entity_id: null, domain_id: null, ...extra });
it("conserves rank and discovers two-hop connections without promoting disconnected hubs", () => {
  const rank = personalizedPageRank(["root", "a", "b", "hub", "x"], [
    { from: "root", to: "a", weight: 1 }, { from: "a", to: "b", weight: 1 }, { from: "hub", to: "x", weight: 100 },
  ], "root");
  expect([...rank.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  expect(rank.get("a")!).toBeGreaterThan(rank.get("b")!);
  expect(rank.get("b")!).toBeGreaterThan(0);
  expect(rank.get("hub")).toBe(0);
  expect(personalizedPageRank(["root", "alone"], [], "root").get("root")).toBeCloseTo(1);
});
it("blends semantic similarity with graph rank and supports embedding-only matches", () => {
  const pages = ["root", "a", "b", "semantic", "weak"].map((id) => page(id));
  const result = rankRelatedArticles(pages, [], "root", "", {
    connections: [{ from: "root", to: "a", weight: 1 }, { from: "root", to: "b", weight: 1 }],
    similarities: [{ id: "b", similarity: 0.95 }, { id: "semantic", similarity: 0.9 }, { id: "weak", similarity: 0.5 }],
  });
  expect(result.map((p) => p.id)).toEqual(["b", "a", "semantic"]);
});
it("excludes self, ancestors, direct children and other organizations even with strong embeddings", () => {
  const pages = [page("parent"), page("root", { parent_page_id: "parent", context_entity_id: "org" }),
    page("child", { parent_page_id: "root" }), page("other", { context_entity_id: "another" }), page("valid")];
  const result = rankRelatedArticles(pages, [], "root", "", { connections: [], similarities: pages.map((p) => ({ id: p.id, similarity: 1 })) });
  expect(result.map((p) => p.id)).toEqual(["valid"]);
});
it("deduplicates scope claims and ranks deterministically without embeddings", () => {
  const pages = ["root", "a", "b"].map((id) => page(id));
  const sections = [{ page_id: "root", query: { unitIds: ["u"] } }, { page_id: "a", query: { unitIds: ["u", "u", "u"] } }, { page_id: "b", query: { unitIds: ["u"] } }];
  const result = rankRelatedArticles(pages, sections, "root");
  expect(result.map((p) => p.id)).toEqual(["a", "b"]);
  expect(result[0]!.score).toBeCloseTo(result[1]!.score);
});
