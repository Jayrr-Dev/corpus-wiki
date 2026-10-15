import { describe, expect, it } from "vitest";
import { buildGraph, shortLabel } from "./build";
import { labelOpacity, toWorld, zoomAt } from "./camera";
import { applyFilters, createdBy } from "./filters";
import { groupColorLookup, parseGroupQuery } from "./groups";
import { neighborhood } from "./neighborhood";
import type { GraphRows } from "./rows";
import { DEFAULT_GRAPH_SETTINGS, parseSavedSettings } from "./settings";
import type { GraphNode } from "./types";

// =====================================================================
// FIXTURE: three units (u3 is an orphan), one entity, one page, a link
// to a unit that is not live (retired), and a domain tree.
// =====================================================================

const T1 = "2026-10-01T00:00:00Z";
const T2 = "2026-10-05T00:00:00Z";
const T3 = "2026-10-09T00:00:00Z";

const rows: GraphRows = {
  units: [
    { id: "u1", kind: "decision", epistemic_status: "established", current_revision_id: "r1", created_at: T1 },
    { id: "u2", kind: "fact", epistemic_status: "disputed", current_revision_id: "r2", created_at: T2 },
    { id: "u3", kind: "fact", epistemic_status: "assumed", current_revision_id: "r3", created_at: T3 },
  ],
  revisions: [
    { id: "r1", content: "Alpha ships on Postgres" },
    { id: "r2", content: "Alpha launch is in March" },
    { id: "r3", content: "Lunch is at noon" },
  ],
  relationships: [
    { id: "l1", from_unit_id: "u2", to_unit_id: "u1", type: "depends_on" },
    { id: "l2", from_unit_id: "u1", to_unit_id: "gone", type: "supports" },
  ],
  entities: [{ id: "e1", name: "Project Alpha", created_at: T1 }],
  unitEntities: [{ unit_id: "u1", entity_id: "e1" }],
  domains: [
    { id: "d1", path: "Projects/Alpha" },
    { id: "d2", path: "Projects/Alpha/Data layer" },
  ],
  unitDomains: [
    { unit_id: "u1", domain_id: "d2" },
    { unit_id: "u2", domain_id: "d1" },
  ],
  pages: [{ id: "p1", title: "Alpha", slug: "alpha", created_at: T2, entity_id: "e1", domain_id: "d1" }],
  sections: [
    { id: "s1", page_id: "p1" },
    { id: "s2", page_id: "p1" },
  ],
  sectionInputs: [
    { section_id: "s1", unit_id: "u1" },
    { section_id: "s2", unit_id: "u1" },
  ],
};

const graph = buildGraph(rows);
const nodeById = (id: string) => graph.nodes.find((node) => node.id === id) as GraphNode;
const ids = (data: { nodes: GraphNode[] }) => data.nodes.map((node) => node.id).sort();
const ALL_LAYERS = { search: "", showEntities: true, showPages: true, showOrphans: true, showRelated: false, relatedness: 0.3 };

describe("buildGraph", () => {
  it("makes a node per live unit, entity and page", () => {
    expect(ids(graph)).toEqual(["e1", "p1", "u1", "u2", "u3"]);
  });

  it("drops links to rows that are not in the graph", () => {
    expect(graph.links.map((link) => link.id)).not.toContain("l2");
  });

  it("links a page to a cited unit once, however many sections cite it", () => {
    expect(graph.links.filter((link) => link.kind === "cites")).toHaveLength(1);
  });

  it("counts degree over the kept links", () => {
    // u1: depends_on from u2, about e1, cited by p1
    expect(nodeById("u1").degree).toBe(3);
    expect(nodeById("u3").degree).toBe(0);
  });

  it("carries the fields group queries match on", () => {
    expect(nodeById("u1")).toMatchObject({ label: "Alpha ships on Postgres", domainPaths: ["Projects/Alpha/Data layer"], entityNames: ["Project Alpha"], href: "/units/u1" });
    expect(nodeById("p1")).toMatchObject({ href: "/p/alpha", domainPaths: ["Projects/Alpha"] });
  });
});

describe("shortLabel", () => {
  it("cuts long claims with an ellipsis", () => {
    expect(shortLabel("a".repeat(80), 10)).toBe(`${"a".repeat(9)}…`);
    expect(shortLabel("  two\nlines  ")).toBe("two lines");
  });
});

describe("applyFilters", () => {
  it("shows units only by default", () => {
    expect(ids(applyFilters(graph, DEFAULT_GRAPH_SETTINGS.filters))).toEqual(["u1", "u2", "u3"]);
  });

  it("adds the entity and page layers when switched on", () => {
    expect(ids(applyFilters(graph, ALL_LAYERS))).toEqual(["e1", "p1", "u1", "u2", "u3"]);
  });

  it("hides orphans, counting only links still visible", () => {
    expect(ids(applyFilters(graph, { ...ALL_LAYERS, showOrphans: false }))).toEqual(["e1", "p1", "u1", "u2"]);
    // With the search keeping only u1, u1 has no visible links left
    expect(ids(applyFilters(graph, { ...ALL_LAYERS, search: "postgres", showOrphans: false }))).toEqual([]);
  });

  it("searches labels ignoring case", () => {
    expect(ids(applyFilters(graph, { ...ALL_LAYERS, search: "ALPHA" }))).toEqual(["e1", "p1", "u1", "u2"]);
  });

  it("cuts the graph at a replay time", () => {
    expect(ids(createdBy(graph, Date.parse(T2)))).toEqual(["e1", "p1", "u1", "u2"]);
  });
});

describe("group queries", () => {
  it("matches a domain and every branch below it", () => {
    const test = parseGroupQuery("domain:projects/alpha");
    expect(test(nodeById("u1"))).toBe(true);
    expect(test(nodeById("u2"))).toBe(true);
    expect(test(nodeById("u3"))).toBe(false);
    expect(parseGroupQuery("path:Projects/Alpha/Data layer/")(nodeById("u2"))).toBe(false);
  });

  it("matches entity, kind, status and plain text", () => {
    expect(parseGroupQuery("entity:alpha")(nodeById("u1"))).toBe(true);
    expect(parseGroupQuery("kind:decision")(nodeById("u1"))).toBe(true);
    expect(parseGroupQuery("kind:page")(nodeById("p1"))).toBe(true);
    expect(parseGroupQuery("status:disputed")(nodeById("u2"))).toBe(true);
    expect(parseGroupQuery("lunch")(nodeById("u3"))).toBe(true);
    expect(parseGroupQuery("   ")(nodeById("u3"))).toBe(false);
  });

  it("colors a node by the first group it matches", () => {
    const colorOf = groupColorLookup([
      { id: "g1", query: "status:disputed", color: "failed" },
      { id: "g2", query: "domain:Projects/Alpha", color: "link" },
    ]);
    expect(colorOf(nodeById("u2"))).toBe("failed");
    expect(colorOf(nodeById("u1"))).toBe("link");
    expect(colorOf(nodeById("u3"))).toBeNull();
  });
});

describe("neighborhood", () => {
  it("walks links in both directions up to the depth", () => {
    expect(ids(neighborhood(graph, "u2", 1))).toEqual(["u1", "u2"]);
    expect(ids(neighborhood(graph, "u2", 2))).toEqual(["e1", "p1", "u1", "u2"]);
    expect(ids(neighborhood(graph, "u3", 3))).toEqual(["u3"]);
  });
});

describe("camera", () => {
  it("keeps the point under the cursor fixed while zooming", () => {
    const camera = { x: 100, y: 50, k: 1 };
    const cursor = { x: 300, y: 200 };
    const before = toWorld(camera, cursor);
    const after = toWorld(zoomAt(camera, cursor, -500), cursor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("fades labels in past the threshold", () => {
    expect(labelOpacity(0.5, 0)).toBe(0);
    expect(labelOpacity(1.5, 0)).toBe(1);
  });
});

describe("saved settings", () => {
  it("falls back to the defaults when the stored shape is wrong", () => {
    expect(parseSavedSettings({ filters: "nope" })).toBe(DEFAULT_GRAPH_SETTINGS);
    expect(parseSavedSettings(DEFAULT_GRAPH_SETTINGS)).toEqual(DEFAULT_GRAPH_SETTINGS);
  });

  it("keeps older saved settings, defaulting the fields added since", () => {
    const { search, showPages, showOrphans } = DEFAULT_GRAPH_SETTINGS.filters;
    const older = { ...DEFAULT_GRAPH_SETTINGS, filters: { search, showEntities: true, showPages, showOrphans } };
    expect(parseSavedSettings(older).filters).toEqual({ ...DEFAULT_GRAPH_SETTINGS.filters, showEntities: true });
  });
});
