import { describe, expect, it } from "vitest";
import { NO_ARTICLE_LABEL } from "./clusters";
import { coalesceDrawn, coalesceGraph } from "./coalesce";
import type { SimNode } from "./physics";
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
    const crowd = Array.from({ length: 100 }, (_, index) =>
      claim(String(index), "Safety"),
    );
    expect(coalesceGraph({ nodes: crowd, links: [] }, "domain").nodes[0]?.degree).toBe(21);
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

  it("draws a combined dot at the middle without moving the claims", () => {
    const a = { ...claim("a", "Safety/PPE"), x: 0, y: 0 } as SimNode;
    const b = { ...claim("b", "Safety/PPE"), x: 10, y: 20 } as SimNode;
    const drawn = coalesceDrawn([a, b], [], "domain", null);
    const blob = drawn.nodes.find((node) => node.memberIds);
    expect(blob).toMatchObject({ x: 5, y: 10, memberIds: ["a", "b"] });
    expect(a).toMatchObject({ x: 0, y: 0 });
    expect(b).toMatchObject({ x: 10, y: 20 });
    const opened = coalesceDrawn([a, b], [], "domain", "Safety/PPE");
    expect(opened.nodes).toEqual([a, b]);
  });

  it("keeps No article connection circles separate", () => {
    const loose = (id: string, extra: Partial<GraphNode> = {}) =>
      claim(id, "", { pageTitles: [], label: id, ...extra });
    const graph: GraphData = {
      nodes: [
        loose("a"),
        loose("b"),
        loose("hub", { degree: 4, label: "Busy claim" }),
        loose("n1"),
        loose("n2"),
        loose("left"),
        loose("right"),
      ],
      links: [
        { id: "h1", source: "hub", target: "n1", kind: "supports" },
        { id: "h2", source: "hub", target: "n2", kind: "supports" },
        { id: "pair", source: "left", target: "right", kind: "supports" },
      ],
    };
    const next = coalesceGraph(graph, "page");
    expect(next.nodes.map((node) => node.label).sort()).toEqual([
      "Busy claim (3)",
      "Linked (2)",
      "Orphans (2)",
    ]);
    const held = coalesceGraph(graph, "page", NO_ARTICLE_LABEL);
    expect(held.nodes.map((node) => node.label).sort()).toEqual([
      "Busy claim (3)",
      "Linked (2)",
      "Orphans (2)",
    ]);
    const orphans = next.nodes.find((node) => node.label === "Orphans (2)");
    const opened = coalesceGraph(graph, "page", orphans!.id.slice("coalesce:".length));
    expect(opened.nodes.map((node) => node.id).sort()).toEqual([
      "a",
      "b",
      `coalesce:${NO_ARTICLE_LABEL}\u001fLinked`,
      "coalesce:No article\u001fhub",
    ]);
  });
});
