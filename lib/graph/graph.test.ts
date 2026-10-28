import { describe, expect, it } from "vitest";
import { buildGraph, shortLabel } from "./build";
import {
  hierarchyOpacity,
  labelOpacity,
  pinchStep,
  REVEAL_AT,
  revealOpacity,
  toWorld,
  zoomAt,
  zoomBy,
} from "./camera";
import {
  circleAt,
  clusterCircles,
  clusterTree,
  createContainment,
  moveTarget,
  packDomains,
} from "./clusters";
import { entityColor } from "./domainColors";
import { applyFilters, createdBy, graphForGrouping } from "./filters";
import {
  groupColorLookup,
  groupCounts,
  groupSuggestions,
  joinGroupQuery,
  parseGroupQuery,
  splitGroupQuery,
} from "./groups";
import { neighborhood } from "./neighborhood";
import type { SimNode } from "./physics";
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
  sources: [],
  sourceUnits: [],
  units: [
    {
      id: "u1",
      kind: "decision",
      epistemic_status: "established",
      current_revision_id: "r1",
      created_at: T1,
    },
    {
      id: "u2",
      kind: "fact",
      epistemic_status: "disputed",
      current_revision_id: "r2",
      created_at: T2,
    },
    {
      id: "u3",
      kind: "fact",
      epistemic_status: "assumed",
      current_revision_id: "r3",
      created_at: T3,
    },
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
  pages: [
    {
      id: "p1",
      title: "Alpha",
      slug: "alpha",
      created_at: T2,
      entity_id: "e1",
      domain_id: "d1",
    },
  ],
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
const nodeById = (id: string) =>
  graph.nodes.find((node) => node.id === id) as GraphNode;
const ids = (data: { nodes: GraphNode[] }) =>
  data.nodes.map((node) => node.id).sort();
const ALL_LAYERS = {
  domainScope: "internal" as const,
  search: "",
  domain: "",
  showUnits: true,
  showEntities: true,
  showDomains: true,
  showPages: true,
  showOrphans: true,
  showRelated: false,
  relatedness: 0.3,
};

describe("buildGraph", () => {
  it("makes a node per live unit, entity, domain and page", () => {
    expect(ids(graph)).toEqual(["d1", "d2", "e1", "p1", "u1", "u2", "u3"]);
  });

  it("drops links to rows that are not in the graph", () => {
    expect(graph.links.map((link) => link.id)).not.toContain("l2");
  });

  it("links a page to a cited unit once, however many sections cite it", () => {
    expect(graph.links.filter((link) => link.kind === "cites")).toHaveLength(1);
  });

  it("links units and pages into their domains", () => {
    expect(
      graph.links
        .filter((link) => link.kind === "in")
        .map((link) => link.id)
        .sort(),
    ).toEqual(["in:p1:d1", "in:u1:d2", "in:u2:d1"]);
    expect(nodeById("d2")).toMatchObject({
      kind: "domain",
      label: "Data layer",
      text: "Projects/Alpha/Data layer",
    });
  });

  it("counts degree over the kept links", () => {
    // u1: depends_on from u2, about e1, cited by p1, in d2
    expect(nodeById("u1").degree).toBe(4);
    expect(nodeById("u3").degree).toBe(0);
  });

  it("carries the fields group queries match on", () => {
    expect(nodeById("u1")).toMatchObject({
      label: "Alpha ships on Postgres",
      domainPaths: ["Projects/Alpha/Data layer"],
      entityNames: ["Project Alpha"],
      href: "/units/u1",
    });
    expect(nodeById("p1")).toMatchObject({
      href: "/p/alpha",
      domainPaths: ["Projects/Alpha"],
    });
  });
});

describe("shortLabel", () => {
  it("cuts long claims with an ellipsis", () => {
    expect(shortLabel("a".repeat(80), 10)).toBe(`${"a".repeat(9)}…`);
    expect(shortLabel("  two\nlines  ")).toBe("two lines");
  });
});

describe("applyFilters", () => {
  it("keeps uploaded book topics Internal even without an organization context", () => {
    const book = buildGraph({
      ...rows,
      domains: rows.domains.map((domain) => ({
        ...domain,
        context_entity_id: null,
      })),
      sources: [{ id: "book", origin: "internal" }],
      sourceUnits: rows.units.map((unit) => ({
        unit_id: unit.id,
        source_id: "book",
      })),
    });
    expect(ids(applyFilters(book, ALL_LAYERS))).toEqual([
      "d1",
      "d2",
      "e1",
      "p1",
      "u1",
      "u2",
      "u3",
    ]);
    expect(
      ids(applyFilters(book, { ...ALL_LAYERS, domainScope: "external" })),
    ).toEqual([]);
    expect(
      book.nodes.find((node) => node.id === "u1")?.domainScopePaths,
    ).toEqual({ internal: ["Projects/Alpha/Data layer"], external: [] });
  });

  it("separates uploaded and external knowledge within the same domain", () => {
    const mixed = buildGraph({
      ...rows,
      domains: rows.domains.map((domain) => ({
        ...domain,
        context_entity_id: "org",
      })),
      unitDomains: [
        { unit_id: "u1", domain_id: "d1" },
        { unit_id: "u2", domain_id: "d1" },
      ],
      sources: [
        { id: "upload", origin: "internal" },
        { id: "web", origin: "external" },
      ],
      sourceUnits: [
        { unit_id: "u1", source_id: "upload" },
        { unit_id: "u2", source_id: "web" },
        { unit_id: "u3", source_id: "web" },
      ],
      sectionInputs: [{ section_id: "s1", unit_id: "u2" }],
    });
    expect(ids(applyFilters(mixed, ALL_LAYERS))).toEqual(["d1", "e1", "u1"]);
    expect(
      ids(applyFilters(mixed, { ...ALL_LAYERS, domainScope: "external" })),
    ).toEqual(["d1", "e1", "p1", "u2", "u3"]);
    expect(
      mixed.nodes.find((node) => node.id === "u2")?.domainScopePaths,
    ).toEqual({ internal: [], external: ["Projects/Alpha"] });
  });

  it("keeps mixed-source units Internal and includes mixed-source pages in both scopes", () => {
    const mixed = buildGraph({
      ...rows,
      sources: [
        { id: "upload", origin: "internal" },
        { id: "web", origin: "external" },
      ],
      sourceUnits: [
        { unit_id: "u1", source_id: "upload" },
        { unit_id: "u1", source_id: "web" },
        { unit_id: "u2", source_id: "web" },
      ],
      sectionInputs: [
        { section_id: "s1", unit_id: "u1" },
        { section_id: "s2", unit_id: "u2" },
      ],
    });
    expect(mixed.nodes.find((node) => node.id === "u1")?.sourceScopes).toEqual([
      "internal",
    ]);
    expect(mixed.nodes.find((node) => node.id === "p1")?.sourceScopes).toEqual([
      "internal",
      "external",
    ]);
    expect(ids(applyFilters(mixed, ALL_LAYERS))).toContain("p1");
    expect(
      ids(applyFilters(mixed, { ...ALL_LAYERS, domainScope: "external" })),
    ).toContain("p1");
  });

  it("hides knowledge units while retaining the other selected layers", () => {
    expect(
      ids(applyFilters(graph, { ...ALL_LAYERS, showUnits: false })),
    ).toEqual(["d1", "d2", "e1", "p1"]);
    expect(
      ids(
        applyFilters(graph, {
          ...DEFAULT_GRAPH_SETTINGS.filters,
          showUnits: false,
        }),
      ),
    ).toEqual([]);
  });
  it("switches domain scopes using source origin and keeps connected entities", () => {
    const scoped = buildGraph({
      ...rows,
      domains: [
        {
          id: "d1",
          path: "Projects/Alpha",
          context_entity_id: "org",
          parent_id: null,
        },
        {
          id: "d2",
          path: "Projects/Alpha/Data layer",
          context_entity_id: null,
          parent_id: "d1",
        },
        {
          id: "ext",
          path: "Reference",
          context_entity_id: null,
          parent_id: null,
        },
      ],
      unitDomains: [...rows.unitDomains, { unit_id: "u3", domain_id: "ext" }],
      sources: [
        { id: "upload", origin: "internal" },
        { id: "web", origin: "external" },
      ],
      sourceUnits: [
        { unit_id: "u1", source_id: "upload" },
        { unit_id: "u2", source_id: "upload" },
        { unit_id: "u3", source_id: "web" },
      ],
    });
    expect(ids(applyFilters(scoped, ALL_LAYERS))).toEqual([
      "d1",
      "d2",
      "e1",
      "p1",
      "u1",
      "u2",
    ]);
    expect(
      ids(applyFilters(scoped, { ...ALL_LAYERS, domainScope: "external" })),
    ).toEqual(["ext", "u3"]);
    expect(
      ids(applyFilters(scoped, { ...ALL_LAYERS, domainScope: "both" })),
    ).toEqual(["d1", "d2", "e1", "ext", "p1", "u1", "u2", "u3"]);
    expect(
      ids(applyFilters(scoped, { ...ALL_LAYERS, domainScope: "none" })),
    ).toEqual([]);
    for (const domainScope of ["both", "none"] as const) {
      expect(
        parseSavedSettings({
          ...DEFAULT_GRAPH_SETTINGS,
          filters: { ...ALL_LAYERS, domainScope },
        }).filters.domainScope,
      ).toBe(domainScope);
    }
    expect(
      parseSavedSettings({
        ...DEFAULT_GRAPH_SETTINGS,
        filters: { ...ALL_LAYERS, domainScope: undefined },
      }).filters.domainScope,
    ).toBe("internal");
  });

  it("shows units only by default", () => {
    expect(ids(applyFilters(graph, DEFAULT_GRAPH_SETTINGS.filters))).toEqual([
      "u1",
      "u2",
      "u3",
    ]);
  });

  it("adds the entity, domain and page layers when switched on", () => {
    expect(ids(applyFilters(graph, ALL_LAYERS))).toEqual([
      "d1",
      "d2",
      "e1",
      "p1",
      "u1",
      "u2",
      "u3",
    ]);
  });

  it("hides orphans, counting only links still visible", () => {
    expect(
      ids(applyFilters(graph, { ...ALL_LAYERS, showOrphans: false })),
    ).toEqual(["d1", "d2", "e1", "p1", "u1", "u2"]);
    // With the search keeping only u1, u1 has no visible links left
    expect(
      ids(
        applyFilters(graph, {
          ...ALL_LAYERS,
          search: "postgres",
          showOrphans: false,
        }),
      ),
    ).toEqual([]);
  });

  it("searches labels ignoring case", () => {
    expect(
      ids(applyFilters(graph, { ...ALL_LAYERS, search: "ALPHA" })),
    ).toEqual(["d1", "d2", "e1", "p1", "u1", "u2"]);
  });

  it("focuses on one domain with its subdomains, keeping entities linked to them", () => {
    expect(
      ids(applyFilters(graph, { ...ALL_LAYERS, domain: "projects/alpha/" })),
    ).toEqual(["d1", "d2", "e1", "p1", "u1", "u2"]);
    expect(
      ids(
        applyFilters(graph, {
          ...ALL_LAYERS,
          domain: "Projects/Alpha/Data layer",
        }),
      ),
    ).toEqual(["d2", "e1", "u1"]);
  });

  it("cuts the graph at a replay time", () => {
    expect(ids(createdBy(graph, Date.parse(T2)))).toEqual([
      "d1",
      "d2",
      "e1",
      "p1",
      "u1",
      "u2",
    ]);
  });
});

describe("group queries", () => {
  it("matches a domain and every branch below it", () => {
    const test = parseGroupQuery("domain:projects/alpha");
    expect(test(nodeById("u1"))).toBe(true);
    expect(test(nodeById("u2"))).toBe(true);
    expect(test(nodeById("u3"))).toBe(false);
    expect(
      parseGroupQuery("path:Projects/Alpha/Data layer/")(nodeById("u2")),
    ).toBe(false);
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
    expect(splitGroupQuery("Domain:Projects/Alpha")).toEqual({
      field: "domain",
      value: "Projects/Alpha",
    });
    expect(splitGroupQuery("path:Projects")).toEqual({
      field: "domain",
      value: "Projects",
    });
    expect(splitGroupQuery("Lunch")).toEqual({ field: "text", value: "Lunch" });
    expect(splitGroupQuery("note: lunch")).toEqual({
      field: "text",
      value: "note: lunch",
    });
    expect(joinGroupQuery("status", "disputed")).toBe("status:disputed");
    expect(joinGroupQuery("text", "Lunch")).toBe("Lunch");
  });

  it("suggests the values present and counts what each group colors", () => {
    const suggestions = groupSuggestions(graph.nodes);
    expect(suggestions.entity).toEqual(["Project Alpha"]);
    expect(suggestions.status).toContain("disputed");
    expect(suggestions.kind).toEqual(
      expect.arrayContaining(["decision", "fact", "domain", "entity", "page"]),
    );
    const counts = groupCounts(
      [
        { id: "g1", query: "status:disputed", color: "failed" },
        { id: "g2", query: "domain:Projects/Alpha", color: "link" },
      ],
      graph.nodes,
    );
    expect(counts.get("g1")).toBe(1);
    // u1, page, and domain hubs; u2 is disputed, so the first group took it
    expect(counts.get("g2")).toBe(4);
  });
});

describe("neighborhood", () => {
  it("walks links in both directions up to the depth", () => {
    expect(ids(neighborhood(graph, "u2", 1))).toEqual(["d1", "u1", "u2"]);
    expect(ids(neighborhood(graph, "u2", 2))).toEqual([
      "d1",
      "d2",
      "e1",
      "p1",
      "u1",
      "u2",
    ]);
    expect(ids(neighborhood(graph, "u3", 3))).toEqual(["u3"]);
  });
});

describe("camera", () => {
  it("zooms smoothly in both directions from a large graph overview below 5%", () => {
    const camera = { x: 400, y: 300, k: 0.003 };
    const cursor = { x: 200, y: 100 };
    const before = toWorld(camera, cursor);
    for (const delta of [-40, 40]) {
      const next = zoomAt(camera, cursor, delta);
      expect(next.k / camera.k).toBeGreaterThan(0.9);
      expect(next.k / camera.k).toBeLessThan(1.1);
      expect(Math.sign(next.k - camera.k)).toBe(-Math.sign(delta));
      expect(toWorld(next, cursor).x).toBeCloseTo(before.x);
      expect(toWorld(next, cursor).y).toBeCloseTo(before.y);
    }
  });
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
    expect(parseSavedSettings({ filters: "nope" })).toBe(
      DEFAULT_GRAPH_SETTINGS,
    );
    expect(parseSavedSettings(DEFAULT_GRAPH_SETTINGS)).toEqual(
      DEFAULT_GRAPH_SETTINGS,
    );
  });

  it("keeps older saved settings, defaulting the fields added since", () => {
    const { search, showPages, showOrphans } = DEFAULT_GRAPH_SETTINGS.filters;
    const older = {
      ...DEFAULT_GRAPH_SETTINGS,
      filters: { search, showEntities: true, showPages, showOrphans },
    };
    expect(parseSavedSettings(older).filters).toEqual({
      ...DEFAULT_GRAPH_SETTINGS.filters,
      showEntities: true,
    });
  });

  it("reads the old domain circles switch as the group", () => {
    const display = { ...DEFAULT_GRAPH_SETTINGS.display };
    delete (display as { groupBy?: string }).groupBy;
    expect(
      parseSavedSettings({
        ...DEFAULT_GRAPH_SETTINGS,
        display: { ...display, domainCircles: false },
      }).display.groupBy,
    ).toBe("off");
    expect(
      parseSavedSettings({
        ...DEFAULT_GRAPH_SETTINGS,
        display: { ...display, domainCircles: true },
      }).display.groupBy,
    ).toBe("domain");
  });
});

describe("claims sharing a topic label", () => {
  it("shows distinct wording instead of two identical topic labels", () => {
    const result = buildGraph({
      ...rows,
      revisions: [
        { id: "r1", content: "The company holds safety meetings every week." },
        {
          id: "r2",
          content: "Supervisors record attendance at safety meetings.",
        },
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

describe("entity groups", () => {
  it("drops the entity dot and the about line so units sit inside the circle", () => {
    const grouped = graphForGrouping(graph, "entity");
    expect(grouped.nodes.map((node) => node.id)).not.toContain("e1");
    expect(grouped.links.some((link) => link.kind === "about")).toBe(false);
    expect(grouped.links.some((link) => link.kind === "depends_on")).toBe(true);
  });

  it("drops domain hubs and in-links when grouping by domain circles", () => {
    const grouped = graphForGrouping(graph, "domain");
    expect(grouped.nodes.map((node) => node.id).sort()).toEqual([
      "e1",
      "p1",
      "u1",
      "u2",
      "u3",
    ]);
    expect(grouped.links.some((link) => link.kind === "in")).toBe(false);
    expect(graphForGrouping(graph, "off")).toBe(graph);
  });

  it("drops page dots and cites links so cited units sit inside the circle", () => {
    expect(nodeById("u1").pageTitles).toEqual(["Alpha"]);
    const grouped = graphForGrouping(graph, "page");
    expect(grouped.nodes.map((node) => node.id)).not.toContain("p1");
    expect(grouped.links.some((link) => link.kind === "cites")).toBe(false);
    expect(grouped.links.some((link) => link.kind === "depends_on")).toBe(true);
  });
});

describe("domain clusters", () => {
  const dot = (
    id: string,
    domainPaths: string[],
    x = 0,
    y = 0,
    entityNames: string[] = [],
  ): SimNode => ({
    ...({} as GraphNode),
    id,
    domainPaths,
    entityNames,
    degree: 0,
    x,
    y,
  });
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  it("draws one colored circle per entity", () => {
    const nodes = [
      dot("a", [], 0, 0, ["Acme"]),
      dot("b", [], 12, 0, ["Acme"]),
      dot("c", [], 80, 40, ["Other"]),
    ];
    const circles = clusterCircles(nodes, 1, "entity");
    expect(circles.map((circle) => circle.label).sort()).toEqual([
      "Acme",
      "Other",
    ]);
    expect(circles.find((circle) => circle.label === "Acme")!.color).toBe(
      entityColor("Acme"),
    );
    expect(circles.every((circle) => circle.color)).toBe(true);
  });

  it("draws one colored circle per page", () => {
    const nodes: SimNode[] = [
      { ...dot("a", []), pageTitles: ["Alpha"] },
      { ...dot("b", []), pageTitles: ["Alpha"] },
      { ...dot("c", []), pageTitles: ["Beta"] },
    ];
    const circles = clusterCircles(nodes, 1, "page");
    expect(circles.map((circle) => circle.label).sort()).toEqual([
      "Alpha",
      "Beta",
    ]);
    expect(circles.find((circle) => circle.label === "Alpha")!.color).toBe(
      entityColor("Alpha"),
    );
  });

  it("packs sibling domains side by side without overlapping", () => {
    const nodes = ["PPE", "Training", "Inspections", "Permits"].flatMap(
      (topic, t) =>
        Array.from({ length: t * 3 + 1 }, (_, i) =>
          dot(`${topic}-${i}`, [`Co/Safety/${topic}`]),
        ),
    );
    const children = clusterCircles(nodes, 1).filter(
      (circle) => circle.depth === 2,
    );
    expect(children).toHaveLength(4);
    for (let i = 0; i < children.length; i++)
      for (let j = i + 1; j < children.length; j++) {
        expect(distance(children[i]!, children[j]!)).toBeGreaterThanOrEqual(
          children[i]!.r + children[j]!.r + 9.99,
        );
      }
  });

  it("makes each parent just big enough for the rings inside it", () => {
    const nodes = [
      dot("a", ["Co/Safety/PPE"]),
      dot("b", ["Co/Safety/Training"]),
      dot("c", ["Co/Safety/Inspections"]),
    ];
    const circles = clusterCircles(nodes, 1);
    const parent = circles.find((circle) => circle.key === "Co/Safety")!;
    const children = circles.filter((circle) => circle.depth === 2);
    for (const child of children)
      expect(distance(child, parent) + child.r).toBeLessThan(parent.r);
    // Tight: the widest child reaches within the parent's padding of its ring
    expect(
      Math.max(...children.map((child) => distance(child, parent) + child.r)),
    ).toBeGreaterThan(parent.r - 20);
  });

  it("sizes rings by how many dots they hold, wherever the dots are", () => {
    const small = clusterCircles(
      [dot("a", ["Co"], 0), dot("b", ["Co"], 900)],
      1,
    )[0]!;
    const big = clusterCircles(
      Array.from({ length: 40 }, (_, i) => dot(`d${i}`, ["Co"])),
      1,
    )[0]!;
    expect(small.r).toBeLessThan(40);
    expect(big.r).toBeGreaterThan(small.r * 2);
  });

  it("gives a parent's own dots a spot of their own, clear of its child rings", () => {
    const nodes = [
      dot("summary", ["Co/Procedure"]),
      dot("scope", ["Co/Procedure"]),
      dot("test", ["Co/Procedure/Testing"]),
      dot("gear", ["Co/Procedure/Equipment"]),
    ];
    const { circles, homes } = packDomains(nodes, 1);
    const spot = homes.get("summary")!;
    expect(homes.get("scope")).toBe(spot);
    for (const child of circles.filter((circle) => circle.depth === 2))
      expect(distance(spot, child)).toBeGreaterThanOrEqual(spot.r + child.r);
  });

  it("keeps each dot inside its own ring, and leaves dragged dots where they are", () => {
    const nodes = [
      dot("a", ["Co/A"], 5000, 0),
      dot("b", ["Co/B"], 0, 0),
      dot("held", ["Co/A"], -5000, 0),
    ];
    nodes[2]!.fx = -5000;
    createContainment(nodes, 1)();
    const { homes } = packDomains(nodes, 1);
    const home = homes.get("a")!;
    expect(
      distance({ x: nodes[0]!.x!, y: nodes[0]!.y! }, home),
    ).toBeLessThanOrEqual(home.r);
    expect(nodes[2]!.x).toBe(-5000);
  });

  it("nests a group for every level of each dot's first domain path", () => {
    const tree = clusterTree([
      dot("a", ["Co/Safety/PPE"]),
      dot("b", ["Co/Safety/WHMIS"]),
      dot("c", ["Co/Safety"]),
      dot("d", []),
    ]);
    expect(tree.map((group) => group.path)).toEqual(["Co"]);
    const [safety] = tree[0]!.children;
    expect(safety?.size).toBe(3);
    expect(safety?.members.map((node) => node.id)).toEqual(["c"]);
    expect(safety?.children.map((group) => group.label)).toEqual([
      "PPE",
      "WHMIS",
    ]);
  });

  it("picks the deepest circle under a point and files a claim there", () => {
    const circles = clusterCircles(
      [dot("a", ["Co/Safety/PPE"]), dot("b", ["Co/Safety/WHMIS"])],
      1,
    );
    const leaf = circles.find((circle) => circle.key === "Co/Safety/PPE")!;
    const parent = circles.find((circle) => circle.key === "Co/Safety")!;
    expect(circleAt(circles, leaf)?.key).toBe("Co/Safety/PPE");
    expect(circleAt(circles, { x: 1e6, y: 1e6 })).toBeNull();
    const claim = { ...dot("a", ["Co/Safety/PPE"]), kind: "unit" as const };
    expect(moveTarget(claim, leaf, null)).toBeNull();
    expect(
      moveTarget(
        claim,
        circles.find((circle) => circle.key === "Co/Safety/WHMIS")!,
        null,
      ),
    ).toBe("Co/Safety/WHMIS");
    expect(moveTarget(claim, parent, "Co/Safety/PPE")).toBe("Co/Safety");
    expect(moveTarget(claim, { key: "Co" }, "Co/Safety/PPE")).toBe("Co");
    expect(moveTarget(claim, { key: "Other" }, "Co/Safety/PPE")).toBeNull();
    expect(moveTarget({ ...claim, kind: "page" }, parent, null)).toBeNull();
  });

  it("draws each outer ring around the rings inside it", () => {
    const circles = clusterCircles(
      [dot("a", ["Co/Safety/PPE"]), dot("b", ["Co/Safety/WHMIS"])],
      1,
    );
    expect(circles.map((circle) => [circle.key, circle.isBranch])).toEqual([
      ["Co", true],
      ["Co/Safety", true],
      ["Co/Safety/PPE", false],
      ["Co/Safety/WHMIS", false],
    ]);
    const [co, safety] = circles;
    expect(co!.r).toBeGreaterThan(safety!.r);
  });
});

describe("progressive zoom", () => {
  it("upgrades the old default spacing without replacing custom forces", () => {
    const forces = {
      center: 0.5,
      repel: 10,
      link: 1,
      linkDistance: 60,
      cluster: 0.5,
    };
    expect(
      parseSavedSettings({ ...DEFAULT_GRAPH_SETTINGS, forces }).forces,
    ).toEqual(DEFAULT_GRAPH_SETTINGS.forces);
    const custom = { ...forces, repel: 7 };
    expect(
      parseSavedSettings({ ...DEFAULT_GRAPH_SETTINGS, forces: custom }).forces,
    ).toEqual(custom);
  });
  it("keeps three hierarchy levels in the overview and reveals deeper ones on zoom", () => {
    expect([0, 1, 2, 3].map((depth) => hierarchyOpacity(depth, 1, 1))).toEqual([
      1, 1, 0, 0,
    ]);
    expect(hierarchyOpacity(2, 2, 1)).toBe(1);
    expect(hierarchyOpacity(3, 2, 1)).toBeLessThan(1);
    expect(hierarchyOpacity(3, 2.6, 1)).toBe(1);
    expect(hierarchyOpacity(3, 4, 1)).toBe(1);
    expect(hierarchyOpacity(5, 1, null)).toBe(1);
  });
  it("hides note titles at the overview and shows them once zoomed in past the reveal", () => {
    expect(revealOpacity(2, 2, REVEAL_AT.title)).toBe(0);
    expect(
      revealOpacity(2 * REVEAL_AT.title * 1.5, 2, REVEAL_AT.title),
    ).toBeCloseTo(1);
  });

  it("shows topic names at the overview", () => {
    expect(revealOpacity(1, 1, REVEAL_AT.subdomain)).toBe(1);
  });
});
