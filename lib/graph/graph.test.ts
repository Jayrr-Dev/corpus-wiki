import { describe, expect, it } from "vitest";
import { buildGraph, shortLabel } from "./build";
import { hierarchyOpacity, labelOpacity, pinchStep, REVEAL_AT, revealOpacity, toWorld, zoomAt, zoomBy } from "./camera";
import { clusterCircles, clusterTree, forceClusters, separateRootDomains } from "./clusters";
import type { SimLink, SimNode } from "./physics";
import { applyFilters, createdBy } from "./filters";
import { groupColorLookup, groupCounts, groupSuggestions, joinGroupQuery, parseGroupQuery, splitGroupQuery } from "./groups";
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
const ALL_LAYERS = { domainScope: "internal" as const, search: "", domain: "", showUnits: true, showEntities: true, showPages: true, showOrphans: true, showRelated: false, relatedness: 0.3 };

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
  it("hides knowledge units while retaining the other selected layers", () => {
    expect(ids(applyFilters(graph, { ...ALL_LAYERS, showUnits: false }))).toEqual(["e1", "p1"]);
    expect(ids(applyFilters(graph, { ...DEFAULT_GRAPH_SETTINGS.filters, showUnits: false }))).toEqual([]);
  });
  it("switches domain scopes using the root context and keeps connected entities", () => {
    const scoped = buildGraph({ ...rows, domains: [
      { id: "d1", path: "Projects/Alpha", context_entity_id: "org", parent_id: null },
      { id: "d2", path: "Projects/Alpha/Data layer", context_entity_id: null, parent_id: "d1" },
      { id: "ext", path: "Reference", context_entity_id: null, parent_id: null },
    ], unitDomains: [...rows.unitDomains, { unit_id: "u3", domain_id: "ext" }] });
    expect(ids(applyFilters(scoped, ALL_LAYERS))).toEqual(["e1", "p1", "u1", "u2"]);
    expect(ids(applyFilters(scoped, { ...ALL_LAYERS, domainScope: "external" }))).toEqual(["u3"]);
    expect(ids(applyFilters(scoped, { ...ALL_LAYERS, domainScope: "both" }))).toEqual(["e1", "p1", "u1", "u2", "u3"]);
    expect(ids(applyFilters(scoped, { ...ALL_LAYERS, domainScope: "none" }))).toEqual([]);
    for (const domainScope of ["both", "none"] as const) {
      expect(parseSavedSettings({ ...DEFAULT_GRAPH_SETTINGS, filters: { ...ALL_LAYERS, domainScope } }).filters.domainScope).toBe(domainScope);
    }
    expect(parseSavedSettings({ ...DEFAULT_GRAPH_SETTINGS, filters: { ...ALL_LAYERS, domainScope: undefined } }).filters.domainScope).toBe("internal");
  });

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

  it("focuses on one domain with its subdomains, keeping entities linked to them", () => {
    expect(ids(applyFilters(graph, { ...ALL_LAYERS, domain: "projects/alpha/" }))).toEqual(["e1", "p1", "u1", "u2"]);
    expect(ids(applyFilters(graph, { ...ALL_LAYERS, domain: "Projects/Alpha/Data layer" }))).toEqual(["e1", "u1"]);
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

  it("matches nothing when a prefix has no value", () => {
    expect(parseGroupQuery("entity:")(nodeById("u1"))).toBe(false);
    expect(parseGroupQuery("domain:  ")(nodeById("u1"))).toBe(false);
  });

  it("splits and joins a query as field + value", () => {
    expect(splitGroupQuery("Domain:Projects/Alpha")).toEqual({ field: "domain", value: "Projects/Alpha" });
    expect(splitGroupQuery("path:Projects")).toEqual({ field: "domain", value: "Projects" });
    expect(splitGroupQuery("Lunch")).toEqual({ field: "text", value: "Lunch" });
    expect(splitGroupQuery("note: lunch")).toEqual({ field: "text", value: "note: lunch" });
    expect(joinGroupQuery("status", "disputed")).toBe("status:disputed");
    expect(joinGroupQuery("text", "Lunch")).toBe("Lunch");
  });

  it("suggests the values present and counts what each group colors", () => {
    const suggestions = groupSuggestions(graph.nodes);
    expect(suggestions.entity).toEqual(["Project Alpha"]);
    expect(suggestions.status).toContain("disputed");
    expect(suggestions.kind).toEqual(expect.arrayContaining(["decision", "fact", "entity", "page"]));
    const counts = groupCounts(
      [
        { id: "g1", query: "status:disputed", color: "failed" },
        { id: "g2", query: "domain:Projects/Alpha", color: "link" },
      ],
      graph.nodes,
    );
    expect(counts.get("g1")).toBe(1);
    // u1 and the page; u2 is disputed, so the first group took it
    expect(counts.get("g2")).toBe(2);
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

  it("zooms by a factor around a point and stays inside the limits", () => {
    const camera = { x: 0, y: 0, k: 1 };
    const point = { x: 50, y: 80 };
    const zoomed = zoomBy(camera, point, 2);
    expect(zoomed.k).toBe(2);
    expect(toWorld(zoomed, point).x).toBeCloseTo(toWorld(camera, point).x);
    expect(zoomBy(camera, point, 1000).k).toBe(8);
  });

  it("keeps the world point between the fingers under them while pinching", () => {
    const camera = { x: 20, y: 10, k: 1 };
    const from = { mid: { x: 100, y: 100 }, distance: 100 };
    const to = { mid: { x: 130, y: 90 }, distance: 150 };
    const grabbed = toWorld(camera, from.mid);
    const after = pinchStep(camera, from, to);
    expect(after.k).toBeCloseTo(1.5);
    expect(toWorld(after, to.mid).x).toBeCloseTo(grabbed.x);
    expect(toWorld(after, to.mid).y).toBeCloseTo(grabbed.y);
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

describe("claims sharing a topic label", () => {
  it("shows distinct wording instead of two identical topic labels", () => {
    const result = buildGraph({
      ...rows,
      revisions: [
        { id: "r1", content: "The company holds safety meetings every week." },
        { id: "r2", content: "Supervisors record attendance at safety meetings." },
        rows.revisions[2]!,
      ],
    });
    const first = result.nodes.find((node) => node.id === "u1")!;
    const second = result.nodes.find((node) => node.id === "u2")!;
    expect(first.label).not.toBe(second.label);
    expect(first.label).toContain("every week");
    expect(second.label).toContain("attendance");
    expect(result.nodes).toHaveLength(graph.nodes.length);
  });
});

describe("domain clusters", () => {
  const dot = (id: string, domainPaths: string[], x = 0, y = 0): SimNode => ({ ...({} as GraphNode), id, domainPaths, degree: 0, x, y });
  it("gathers sparse members around their own group even far from the layout target", () => {
    const nodes = [dot("a", ["Co/Safety"], 900), dot("b", ["Co/Safety"], 1100)];
    const force = forceClusters(0.5);
    force.initialize!(nodes, Math.random);
    force(1);
    // Translation toward the global target must not prevent local contraction.
    expect(nodes[1]!.vx! - nodes[0]!.vx!).toBeLessThan(-60);
    const disabled = forceClusters(0);
    const resting = [dot("a", ["Co"], -100), dot("b", ["Co"], 100)];
    disabled.initialize!(resting, Math.random);
    disabled(1);
    expect(resting.every((node) => !node.vx && !node.vy)).toBe(true);
  });
  it("fits an uneven cluster tightly while containing every dot", () => {
    const nodes = [dot("a", ["Co"], 0), dot("b", ["Co"], 1), dot("c", ["Co"], 2), dot("outlier", ["Co"], 200)];
    const [circle] = clusterCircles(nodes, 1);
    expect(circle!.r).toBeLessThan(120);
    for (const node of nodes) {
      expect(Math.hypot(node.x! - circle!.x, node.y! - circle!.y) + 3).toBeLessThanOrEqual(circle!.r);
    }
  });
  it("separates root bounds without spreading their nested members", () => {
    const nodes = [dot("a", ["A/Child"], 0, 0), dot("b", ["A/Child"], 20, 10), dot("c", ["B/Child"], 5, 0), dot("d", ["B/Child"], 25, 10)];
    separateRootDomains(nodes, 1);
    const [a, b] = clusterCircles(nodes, 1).filter((circle) => circle.depth === 0);
    expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeGreaterThanOrEqual(a!.r + b!.r + 31.99);
    expect(nodes[1]!.x! - nodes[0]!.x!).toBe(20);
    expect(nodes[1]!.y! - nodes[0]!.y!).toBe(10);
  });
  it("lets connected roots sit closer, with explicit links stronger than similarity", () => {
    const distance = (kind?: SimLink["kind"]) => {
      const nodes = [dot("a", ["A/Child"], 0, 0), dot("b", ["B/Child"], 0, 0)];
      const links = kind ? [{ source: "a", target: "b", kind } as SimLink] : [];
      separateRootDomains(nodes, 1, links);
      return Math.abs(nodes[0]!.x! - nodes[1]!.x!);
    };
    expect(distance("similar")).toBeLessThan(distance());
    expect(distance("supports")).toBeLessThan(distance("similar"));
  });

  it("expands a parent around separated sibling bubbles", () => {
    const nodes = [dot("a", ["Co/Safety/PPE"], 0, 0), dot("b", ["Co/Safety/Training"], 1, 0), dot("c", ["Co/Safety/Inspections"], 2, 0)];
    for (let tick = 0; tick < 20; tick++) separateRootDomains(nodes, 1);
    const circles = clusterCircles(nodes, 1);
    const parent = circles.find((circle) => circle.key === "Co/Safety")!;
    const children = circles.filter((circle) => circle.depth === 2);
    for (const child of children) {
      expect(Math.hypot(child.x - parent.x, child.y - parent.y) + child.r).toBeLessThan(parent.r);
      for (const other of children) {
        if (child === other) continue;
        expect(Math.hypot(child.x - other.x, child.y - other.y)).toBeGreaterThanOrEqual(child.r + other.r + 31.9);
      }
    }
  });

  it("keeps parent summary dots outside child circles without changing memberships", () => {
    const nodes = [
      dot("summary", ["Co/Procedure"], 0, 0),
      dot("scope", ["Co/Procedure"], 8, 5),
      dot("test-a", ["Co/Procedure/Testing"], -40, 0),
      dot("test-b", ["Co/Procedure/Testing"], 40, 0),
      dot("equipment", ["Co/Procedure/Equipment"], 0, 10),
    ];
    const assignments = nodes.map(node => [...node.domainPaths]);
    separateRootDomains(nodes, 1);
    const circles = clusterCircles(nodes, 1);
    for (const child of circles.filter(circle => circle.depth === 2)) {
      for (const parent of nodes.slice(0, 2)) {
        expect(Math.hypot(parent.x! - child.x, parent.y! - child.y)).toBeGreaterThan(child.r + 3);
      }
    }
    expect(nodes.map(node => node.domainPaths)).toEqual(assignments);
    expect(nodes[1]!.x! - nodes[0]!.x!).toBeCloseTo(8);
    expect(nodes[3]!.x! - nodes[2]!.x!).toBeCloseTo(80);
  });

  it("clears a large bubble from crowded siblings in one layout update", () => {
    const nodes = [
      dot("ppe-a", ["Co/Safety/PPE"], -130, 0),
      dot("ppe-b", ["Co/Safety/PPE"], 130, 0),
      ...Array.from({ length: 9 }, (_, i) => dot(`small-${i}`, [`Co/Safety/Topic ${i}`], i * 12 - 48, 20)),
    ];
    separateRootDomains(nodes, 1);
    const children = clusterCircles(nodes, 1).filter((circle) => circle.depth === 2);
    for (let i = 0; i < children.length; i++) for (let j = i + 1; j < children.length; j++) {
      const a = children[i]!, b = children[j]!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r + 31.8);
    }
    expect(nodes[1]!.x! - nodes[0]!.x!).toBeCloseTo(260);
  });

  it("nests a group for every level of each dot's first domain path", () => {
    const tree = clusterTree([dot("a", ["Co/Safety/PPE"]), dot("b", ["Co/Safety/WHMIS"]), dot("c", ["Co/Safety"]), dot("d", [])]);
    expect(tree.map((group) => group.path)).toEqual(["Co"]);
    const [safety] = tree[0]!.children;
    expect(safety?.size).toBe(3);
    expect(safety?.members.map((node) => node.id)).toEqual(["c"]);
    expect(safety?.children.map((group) => group.label)).toEqual(["PPE", "WHMIS"]);
  });

  it("draws each outer ring around the rings inside it", () => {
    const circles = clusterCircles([dot("a", ["Co/Safety/PPE"], -50, 0), dot("b", ["Co/Safety/WHMIS"], 50, 0)], 1);
    expect(circles.map((circle) => [circle.key, circle.isBranch])).toEqual([["Co", true], ["Co/Safety", true], ["Co/Safety/PPE", false], ["Co/Safety/WHMIS", false]]);
    const [co, safety] = circles;
    expect(co!.r).toBeGreaterThan(safety!.r);
  });
});

describe("progressive zoom", () => {
  it("upgrades the old default spacing without replacing custom forces", () => {
    const forces = { center: 0.5, repel: 10, link: 1, linkDistance: 60, cluster: 0.5 };
    expect(parseSavedSettings({ ...DEFAULT_GRAPH_SETTINGS, forces }).forces).toEqual(DEFAULT_GRAPH_SETTINGS.forces);
    const custom = { ...forces, repel: 7 };
    expect(parseSavedSettings({ ...DEFAULT_GRAPH_SETTINGS, forces: custom }).forces).toEqual(custom);
  });
  it("keeps three hierarchy levels in the overview and reveals deeper ones on zoom", () => {
    expect([0, 1, 2, 3].map((depth) => hierarchyOpacity(depth, 1, 1))).toEqual([1, 1, 1, 0]);
    expect(hierarchyOpacity(2, 2.4, 1)).toBeCloseTo(1);
    expect(hierarchyOpacity(3, 2.4, 1)).toBe(1);
    expect(hierarchyOpacity(3, 4, 1)).toBe(1);
    expect(hierarchyOpacity(5, 1, null)).toBe(1);
  });
  it("hides note titles at the overview and shows them once zoomed in past the reveal", () => {
    expect(revealOpacity(2, 2, REVEAL_AT.title)).toBe(0);
    expect(revealOpacity(2 * REVEAL_AT.title * 1.5, 2, REVEAL_AT.title)).toBeCloseTo(1);
  });

  it("shows topic names at the overview", () => {
    expect(revealOpacity(1, 1, REVEAL_AT.subdomain)).toBe(1);
  });
});
