import { afterEach, describe, expect, it } from "vitest";
import { clusterKey } from "./clusters";
import { graphForGrouping, keepNodes } from "./filters";
import { GROUPING_IDS, GROUPING_LIST, GROUPINGS } from "./groupings";
import {
  NODE_KINDS,
  NODE_TYPE_LIST,
  NODE_TYPES,
  type NodeTypeRule,
} from "./nodeTypes";
import type { GraphData, GraphLink, GraphNode, GraphNodeKind } from "./types";

function node(
  id: string,
  kind: string,
  fields: Partial<GraphNode> = {},
): GraphNode {
  return {
    id, kind: kind as GraphNodeKind, label: id, text: id, href: "",
    createdAt: "2026-01-01T00:00:00.000Z", degree: 1, domainPaths: [],
    entityNames: [], pageTitles: [], unitKind: null, status: null, ...fields,
  };
}

function link(source: string, target: string, kind: GraphLink["kind"]): GraphLink {
  return { id: `${source}-${target}`, source, target, kind };
}

// One of each kind. The page has no domain or entity of its own, so every
// non-own grouping has to place it, and the entity and domain, by their knowledge.
function sample(): GraphData {
  return {
    nodes: [
      node("u1", "unit", {
        domainPaths: ["Ops"], entityNames: ["Acme", "Pat"], stakeholderNames: ["Pat"], pageTitles: ["Guide"],
        pageSections: [{ page: "Guide", section: "Intro", position: 0 }],
      }),
      node("Ops", "domain", { domainPaths: ["Ops"] }),
      node("Acme", "entity", { entityNames: ["Acme"] }),
      node("Pat", "stakeholder", { entityNames: ["Pat"], stakeholderNames: ["Pat"] }),
      node("Guide", "page", { pageTitles: ["Guide"] }),
    ],
    links: [
      link("u1", "Ops", "in"),
      link("u1", "Acme", "about"),
      link("u1", "Pat", "about"),
      link("Guide", "u1", "cites"),
    ],
  };
}

// Every dot of this kind is kept, and each sits in a circle
function expectAllInCircles(kind: string, grouping: (typeof GROUPING_IDS)[number], data: GraphData) {
  const visible = keepNodes(data, (dot) => dot.kind === kind);
  const grouped = graphForGrouping(visible, grouping, data);
  const kept = grouped.nodes.filter((dot) => dot.kind === kind);
  expect(kept.map((dot) => dot.id)).toEqual(visible.nodes.map((dot) => dot.id));
  for (const dot of kept)
    expect(clusterKey(dot, grouping), `${kind} in ${grouping}`).not.toBeNull();
}

describe("node type and grouping registries", () => {
  it("lists every node kind once, under its own key", () => {
    expect(NODE_TYPE_LIST.map((rule) => rule.kind).sort()).toEqual(
      [...NODE_KINDS].sort(),
    );
    for (const kind of NODE_KINDS) expect(NODE_TYPES[kind].kind).toBe(kind);
  });

  it("lists every grouping once, under its own key", () => {
    expect(GROUPING_LIST.map((rule) => rule.id)).toEqual([...GROUPING_IDS]);
    for (const id of GROUPING_IDS) expect(GROUPINGS[id].id).toBe(id);
  });

  it("builds each grouping around a hub kind", () => {
    for (const grouping of GROUPING_LIST)
      expect(NODE_TYPES[grouping.hubKind].role).toBe("hub");
  });

  it("only centers a node in a grouping built around its own kind", () => {
    for (const rule of NODE_TYPE_LIST) {
      if (!rule.centers) continue;
      expect(GROUPINGS[rule.centers].hubKind).toBe(rule.kind);
    }
  });
});

describe("every node type in every grouping", () => {
  for (const kind of NODE_KINDS)
    for (const grouping of GROUPING_IDS)
      it(`puts ${kind} nodes in circles when grouped by ${grouping}`, () =>
        expectAllInCircles(kind, grouping, sample()));
});

describe("a node type added only to the registry", () => {
  const types = NODE_TYPES as Record<string, NodeTypeRule>;
  afterEach(() => {
    delete types.volunteer;
  });

  it("is placed by its knowledge in every grouping", () => {
    types.volunteer = {
      ...NODE_TYPES.entity,
      kind: "volunteer" as GraphNodeKind,
      label: "Volunteer",
      plural: "Volunteers",
      centers: undefined,
    };
    const data = sample();
    data.nodes[0]!.entityNames = ["Acme", "Pat", "Sam"];
    data.nodes.push(node("Sam", "volunteer", { entityNames: ["Sam"] }));
    data.links.push(link("u1", "Sam", "about"));
    for (const grouping of GROUPING_IDS)
      expectAllInCircles("volunteer", grouping, data);
  });
});
