import { expect, it } from "vitest";
import { articleBacklinks } from "./articleBacklinks";
import { rankRelatedArticles } from "./relatedArticles";

const pages = [
  { id: "dm", title: "DM&E", slug: "dm-e", entity_id: "entity", domain_id: null },
  { id: "quality", title: "Quality inspection", slug: "quality", entity_id: null, domain_id: null },
];
it("recommends articles linking to this page even without vectors or shared claims", () => {
  const connections = articleBacklinks(pages, [], [], [{ id: "quality", text: "DM&E inspects products. DM&E reports defects." }], "dm");
  expect(connections).toEqual([{ from: "quality", to: "dm", weight: 2 }]);
  expect(rankRelatedArticles(pages, [], "dm", "", { connections, similarities: [] }).map((p) => p.id)).toEqual(["quality"]);
});
it("resolves aliases using the paragraph linker, excluding self and partial matches", () => {
  const entities = [{ id: "entity", name: "DM&E", aliases: ["DME"] }];
  expect(articleBacklinks(pages, entities, [], [{ id: "quality", text: "DME checks goods" }, { id: "dm", text: "DM&E" }], "dm")).toHaveLength(1);
  expect(articleBacklinks(pages, entities, [], [{ id: "quality", text: "DMEX" }], "dm")).toEqual([]);
});
