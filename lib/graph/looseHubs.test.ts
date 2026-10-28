import { expect, it } from "vitest";
import { packDomains } from "./clusters";
import type { SimNode } from "./physics";
import type { GraphNodeKind } from "./types";

function dot(id: string, kind: GraphNodeKind, domainPaths: string[]): SimNode {
  return {
    id, kind, label: id, text: "", href: "", createdAt: "", degree: 1,
    domainPaths, entityNames: kind === "entity" ? [id] : [], pageTitles: [],
    unitKind: null, status: null, x: 0, y: 0,
  };
}

it("gives an entity with no domain the loose spot in Domain grouping", () => {
  const nodes = [
    dot("u1", "unit", ["Ops"]),
    dot("u2", "unit", []),
    dot("Acme", "entity", []),
  ];
  const { homes } = packDomains(nodes, 1, "domain");
  expect(homes.has("u2")).toBe(true);
  expect(homes.get("Acme")).toEqual(homes.get("u2"));
});

it("keeps a domain hub with no circle out of the loose spot", () => {
  const nodes = [dot("u1", "unit", []), dot("d1", "domain", [])];
  const { homes } = packDomains(nodes, 1, "domain");
  expect(homes.has("d1")).toBe(false);
});
