import { describe, expect, it } from "vitest";
import { coalesceGraph } from "./coalesce";
import type { GraphData, GraphNode } from "./types";

function claim(
  id: string,
  domain: string,
  extra: Partial<GraphNode> = {},
): GraphNode {
  return {
    id,
    kind: "unit",
    label: id,
    text: id,
    href: `/units/${id}`,
    createdAt: "2026-01-01T00:00:00Z",
    degree: 1,
    domainPaths: domain ? [domain] : [],
    entityNames: [],
    unitKind: "fact",
    status: "established",
    ...extra,
  };
}

describe("coalesceGraph", () => {
  it("combines claims that share a domain and keeps loners", () => {
    const graph: GraphData = {
      nodes: [
        claim("a", "Safety/PPE"),
        claim("b", "Safety/PPE", { degree: 8 }),
        claim("c", "Safety"),
        claim("alone", ""),
        {
          ...claim("hub", "Safety/PPE"),
          kind: "domain",
          label: "PPE",
          unitKind: null,
          status: null,
        },
      ],
      links: [
        { id: "in", source: "a", target: "b", kind: "supports" },
        { id: "out", source: "a", target: "c", kind: "supports" },
        { id: "also", source: "b", target: "c", kind: "similar" },
      ],
    };

    const next = coalesceGraph(graph, "domain");
    const combined = next.nodes.find((node) => node.id === "coalesce:Safety/PPE");
    expect(combined?.label).toBe("PPE (2)");
    expect(combined?.memberIds).toEqual(["a", "b"]);
    expect(combined?.degree).toBe(8);
    expect(next.nodes.map((node) => node.id).sort()).toEqual([
      "alone",
      "c",
      "coalesce:Safety/PPE",
      "hub",
    ]);
    expect(next.links).toEqual([
      {
        id: "out",
        source: "coalesce:Safety/PPE",
        target: "c",
        kind: "supports",
      },
    ]);
  });

  it("combines by entity name in entity mode", () => {
    const graph: GraphData = {
      nodes: [
        claim("a", "", { entityNames: ["Ada"] }),
        claim("b", "", { entityNames: ["Ada"] }),
        claim("c", "", { entityNames: ["Bea"] }),
      ],
      links: [],
    };
    const next = coalesceGraph(graph, "entity");
    expect(next.nodes.map((node) => node.label).sort()).toEqual([
      "Ada (2)",
      "c",
    ]);
  });

  it("splits the opened group and the groups inside it", () => {
    const graph: GraphData = {
      nodes: [
        claim("a", "Safety/PPE"),
        claim("b", "Safety/PPE"),
        claim("c", "Other"),
        claim("d", "Other"),
      ],
      links: [],
    };
    const opened = coalesceGraph(graph, "domain", "Safety");
    expect(opened.nodes.map((node) => node.id).sort()).toEqual([
      "a",
      "b",
      "coalesce:Other",
    ]);
    const leaf = coalesceGraph(graph, "domain", "Safety/PPE");
    expect(leaf.nodes.map((node) => node.id).sort()).toEqual([
      "a",
      "b",
      "coalesce:Other",
    ]);
  });
});
