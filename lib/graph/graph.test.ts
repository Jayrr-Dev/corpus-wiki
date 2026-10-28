import { describe, expect, it } from "vitest";
import { buildGraph, shortLabel } from "./build";
import {
  groupLabelPx,
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
  circleNestedIn,
  circleOpenTarget,
  clusterCircles,
  clusterConnections,
  clusterTree,
  createContainment,
  EXTERNAL_LABEL,
  LINKED_LABEL,
  moveTarget,
  NO_ARTICLE_LABEL,
  nodeInCluster,
  ORPHANS_LABEL,
  packDomains,
  pageDropLabel,
  pageMoveTarget,
  pageSectionKey,
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
import { nodeRadius, type SimNode } from "./physics";
import { recentMarkedKeys, recentUnitIds } from "./recentUnits";
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
    { id: "s1", page_id: "p1", title: "Facts", position: 1 },
    { id: "s2", page_id: "p1", title: "History", position: 0 },
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
const ALL_SHOWN = { unit: true, entity: true, domain: true, page: true };
const ALL_LAYERS = {
  domainScope: "internal" as const,
  search: "",
  domain: "",
  shown: ALL_SHOWN,
  showOrphans: true,
  showConnectors: true,
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
    expect(nodeById("u1").pageSections).toEqual([
      { page: "Alpha", section: "Facts", position: 1 },
      { page: "Alpha", section: "History", position: 0 },
    ]);
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

  it("records when an article and its sections were created", () => {
    const built = buildGraph({
      ...rows,
      sections: rows.sections.map((section) =>
        section.id === "s1" ? { ...section, created_at: T3 } : section,
      ),
    });
    const times = built.nodes[0]?.articleCreatedAt;
    expect(times?.pages.get("Alpha")).toBe(T2);
    expect(times?.sections.get(pageSectionKey("Alpha", "Facts"))).toBe(T3);
    expect(times?.sections.has(pageSectionKey("Alpha", "History"))).toBe(false);
  });

  it("keeps the later of a unit change and a later move or use", () => {
    const built = buildGraph({
      ...rows,
      units: rows.units.map((unit) =>
        unit.id === "u1" ? { ...unit, last_changed_at: T1 } : unit,
      ),
      touches: [
        { unit_id: "u1", at: "2026-10-20T00:00:00Z" },
        { unit_id: "u1", at: T2 },
      ],
    });
    expect(built.nodes.find((node) => node.id === "u1")?.activityAt).toBe(
      "2026-10-20T00:00:00Z",
    );
  });

  it("marks the newest tenth of knowledge units, articles, and sections", () => {
    const nodes = Array.from({ length: 20 }, (_, index) => ({
      id: `u${String(index).padStart(2, "0")}`,
      kind: "unit" as const,
      activityAt: `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    const marked = recentUnitIds(nodes);
    expect([...marked].sort()).toEqual(["u18", "u19"]);
    const articles = nodes.map((node) => ({
      key: node.id,
      at: node.activityAt,
    }));
    expect([...recentMarkedKeys(articles)].sort()).toEqual(["u18", "u19"]);
    expect(recentUnitIds(nodes.slice(0, 4)).size).toBe(1);
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
      ids(
        applyFilters(graph, {
          ...ALL_LAYERS,
          shown: { ...ALL_SHOWN, unit: false },
        }),
      ),
    ).toEqual(["d1", "d2", "e1", "p1"]);
    expect(
      ids(
        applyFilters(graph, {
          ...DEFAULT_GRAPH_SETTINGS.filters,
          shown: { ...DEFAULT_GRAPH_SETTINGS.filters.shown, unit: false },
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
    const display = { ...DEFAULT_GRAPH_SETTINGS.display };
    delete (display as { showNew?: boolean }).showNew;
    delete (display as { edgeOpacity?: number }).edgeOpacity;
    const parsed = parseSavedSettings({
      ...DEFAULT_GRAPH_SETTINGS,
      display,
    }).display;
    expect(parsed.showNew).toBe(true);
    expect(parsed.edgeOpacity).toBe(0.7);
  });

  it("keeps older saved settings, defaulting the fields added since", () => {
    const { search, showOrphans } = DEFAULT_GRAPH_SETTINGS.filters;
    const older = {
      ...DEFAULT_GRAPH_SETTINGS,
      filters: { search, showEntities: true, showPages: false, showOrphans },
    };
    expect(parseSavedSettings(older).filters).toEqual({
      ...DEFAULT_GRAPH_SETTINGS.filters,
      shown: { ...DEFAULT_GRAPH_SETTINGS.filters.shown, entity: true },
    });
  });

  it("carries each old per-type switch into the shown map", () => {
    const older = {
      ...DEFAULT_GRAPH_SETTINGS,
      filters: {
        ...DEFAULT_GRAPH_SETTINGS.filters,
        shown: undefined,
        showUnits: false,
        showEntities: true,
        showDomains: true,
        showPages: true,
      },
    };
    expect(parseSavedSettings(older).filters.shown).toEqual({
      unit: false,
      entity: true,
      domain: true,
      page: true,
    });
  });

  it("defaults a node type missing from a saved shown map", () => {
    const saved = {
      ...DEFAULT_GRAPH_SETTINGS,
      filters: { ...DEFAULT_GRAPH_SETTINGS.filters, shown: { entity: true } },
    };
    expect(parseSavedSettings(saved).filters.shown).toEqual({
      ...DEFAULT_GRAPH_SETTINGS.filters.shown,
      entity: true,
    });
  });

  it("falls back to domain grouping for a grouping that does not exist", () => {
    const saved = {
      ...DEFAULT_GRAPH_SETTINGS,
      display: { ...DEFAULT_GRAPH_SETTINGS.display, groupBy: "planet" },
      forces: { ...DEFAULT_GRAPH_SETTINGS.forces, repel: 5 },
    };
    const parsed = parseSavedSettings(saved);
    expect(parsed.display.groupBy).toBe("domain");
    expect(parsed.forces.repel).toBe(5);
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
  it("hides domain nodes in entity grouping until the Domains toggle is on", () => {
    const hidden = graphForGrouping(
      applyFilters(graph, {
        ...ALL_LAYERS,
        shown: { ...ALL_SHOWN, domain: false },
      }),
      "entity",
    );
    expect(hidden.nodes.some((node) => node.kind === "domain")).toBe(false);
    const shown = graphForGrouping(applyFilters(graph, ALL_LAYERS), "entity");
    expect(shown.nodes.some((node) => node.kind === "domain")).toBe(true);
    expect(shown.nodes.some((node) => node.kind === "entity")).toBe(true);
  });

  it("keeps the entity dot and its about lines so it sits in the middle of its circle", () => {
    const grouped = graphForGrouping(graph, "entity");
    expect(grouped.nodes.map((node) => node.id)).toContain("e1");
    expect(grouped.links.some((link) => link.kind === "about")).toBe(true);
    expect(grouped.links.some((link) => link.kind === "depends_on")).toBe(true);
  });

  it("shows entity nodes in entity grouping when they are the only layer on", () => {
    const entitiesOnly = applyFilters(graph, {
      ...ALL_LAYERS,
      shown: { unit: false, entity: true, domain: false, page: false },
    });
    const grouped = graphForGrouping(entitiesOnly, "entity", graph);
    expect(grouped.nodes.length).toBeGreaterThan(0);
    expect(grouped.nodes.every((node) => node.kind === "entity")).toBe(true);
  });

  it("puts the domain hub inside the entity group that shares its claims", () => {
    const base = {
      text: "",
      href: "/",
      createdAt: T1,
      pageTitles: [] as string[],
      unitKind: null,
      status: null,
    };
    const node = (
      id: string,
      kind: GraphNode["kind"],
      extra: Partial<GraphNode>,
    ): GraphNode => ({
      ...base,
      id,
      kind,
      label: id,
      degree: 0,
      domainPaths: [],
      entityNames: [],
      ...extra,
    });
    const data = {
      nodes: [
        node("hub", "domain", { domainPaths: ["Safety"], degree: 20 }),
        node("small", "domain", { domainPaths: ["Safety/PPE"], degree: 2 }),
        node("u1", "unit", { domainPaths: ["Safety"], entityNames: ["Acme"] }),
        node("u2", "unit", { domainPaths: ["Safety"], entityNames: ["Acme"] }),
        node("u3", "unit", {
          domainPaths: ["Safety/PPE"],
          entityNames: ["Acme"],
        }),
        node("u4", "unit", { domainPaths: ["Safety"], entityNames: ["Other"] }),
      ],
      links: [],
    };
    const grouped = graphForGrouping(data, "entity");
    expect(
      grouped.nodes.find((item) => item.id === "hub")?.entityNames,
    ).toEqual(["Acme"]);
    expect(
      grouped.nodes.find((item) => item.id === "small")?.entityNames,
    ).toEqual(["Acme"]);
    const placed = grouped.nodes.map((item) => ({ ...item, x: 0, y: 0 }));
    const circles = clusterCircles(placed, 1, "entity");
    expect(circles.map((circle) => circle.key).sort()).toEqual([
      "Acme",
      "Other",
    ]);
    const acme = circles.find((circle) => circle.key === "Acme")!;
    const { homes } = packDomains(placed, 1, "entity");
    const home = homes.get("hub")!;
    expect(home).toEqual(homes.get("u1"));
    expect(homes.get("small")).toEqual(home);
    expect(Math.hypot(acme.x - home.x, acme.y - home.y)).toBeLessThan(acme.r);
    const flung = placed.map((item) =>
      item.id === "hub" || item.id === "small"
        ? { ...item, x: 5000, y: 5000 }
        : item,
    );
    createContainment(flung, 1, "entity")();
    for (const id of ["hub", "small"]) {
      const node = flung.find((item) => item.id === id)!;
      expect(
        Math.hypot(node.x - acme.x, node.y - acme.y) + nodeRadius(node, 1),
      ).toBeLessThanOrEqual(acme.r + 1e-6);
    }
  });

  it("groups domain hubs by entity even when knowledge units are hidden", () => {
    const base = {
      text: "",
      href: "/",
      createdAt: T1,
      pageTitles: [] as string[],
      unitKind: null,
      status: null,
    };
    const node = (
      id: string,
      kind: GraphNode["kind"],
      extra: Partial<GraphNode>,
    ): GraphNode => ({
      ...base,
      id,
      kind,
      label: id,
      degree: kind === "domain" ? 4 : 1,
      domainPaths: [],
      entityNames: [],
      ...extra,
    });
    const data = {
      nodes: [
        node("hub", "domain", { domainPaths: ["Safety"] }),
        node("child", "domain", { domainPaths: ["Safety/Gloves"] }),
        node("solo", "domain", { domainPaths: ["Solo"] }),
        node("u1", "unit", { domainPaths: ["Safety"], entityNames: ["Acme"] }),
        node("u2", "unit", { domainPaths: ["Solo"], entityNames: [] }),
        node("u3", "unit", {
          domainPaths: ["Safety"],
          entityNames: ["Acme"],
        }),
      ],
      links: [
        {
          id: "r1",
          source: "u2",
          target: "u3",
          kind: "depends_on" as const,
        },
      ],
    };
    const domainsOnly = {
      nodes: data.nodes.filter((item) => item.kind === "domain"),
      links: [],
    };
    const grouped = graphForGrouping(domainsOnly, "entity", data);
    expect(
      grouped.nodes.find((item) => item.id === "hub")?.entityNames,
    ).toEqual(["Acme"]);
    expect(
      grouped.nodes.find((item) => item.id === "child")?.entityNames,
    ).toEqual(["Acme"]);
    expect(
      grouped.nodes.find((item) => item.id === "solo")?.entityNames,
    ).toEqual(["Acme"]);
    const placed = grouped.nodes.map((item) => ({ ...item, x: 0, y: 0 }));
    expect(
      clusterCircles(placed, 1, "entity").map((circle) => circle.key),
    ).toEqual(["Acme"]);
  });

  it("groups domain hubs by the article and section that use them", () => {
    const base = {
      text: "",
      href: "/",
      createdAt: T1,
      pageTitles: [] as string[],
      unitKind: null,
      status: null,
    };
    const node = (
      id: string,
      kind: GraphNode["kind"],
      extra: Partial<GraphNode>,
    ): GraphNode => ({
      ...base,
      id,
      kind,
      label: id,
      degree: kind === "domain" ? 4 : 1,
      domainPaths: [],
      entityNames: [],
      ...extra,
    });
    const cited = (
      id: string,
      path: string,
      page: string,
      section: string,
      position: number,
    ) =>
      node(id, "unit", {
        domainPaths: [path],
        pageTitles: [page],
        pageSections: [{ page, section, position }],
      });
    const data = {
      nodes: [
        node("hub", "domain", { domainPaths: ["Safety"] }),
        node("child", "domain", { domainPaths: ["Safety/Gloves"] }),
        node("solo", "domain", { domainPaths: ["Solo"] }),
        cited("u1", "Safety", "Alpha", "History", 0),
        cited("u2", "Safety", "Alpha", "Facts", 1),
        cited("u3", "Safety", "Alpha", "Facts", 1),
        cited("u4", "Safety", "Beta", "Notes", 0),
        node("u5", "unit", { domainPaths: ["Solo"] }),
        cited("u6", "Safety", "Alpha", "Facts", 1),
      ],
      links: [
        {
          id: "r1",
          source: "u5",
          target: "u6",
          kind: "depends_on" as const,
        },
      ],
    };
    const domainsOnly = {
      nodes: data.nodes.filter((item) => item.kind === "domain"),
      links: [],
    };
    const grouped = graphForGrouping(domainsOnly, "page", data);
    for (const id of ["hub", "child", "solo"]) {
      const domain = grouped.nodes.find((item) => item.id === id);
      expect(domain?.pageTitles).toEqual(["Alpha"]);
      expect(domain?.pageSections).toEqual([
        { page: "Alpha", section: "Facts", position: 1 },
      ]);
    }
    const placed = grouped.nodes.map((item) => ({ ...item, x: 0, y: 0 }));
    expect(
      clusterCircles(placed, 1, "page")
        .map((circle) => circle.key)
        .sort(),
    ).toEqual(["Alpha", pageSectionKey("Alpha", "Facts")]);
  });

  it("shows domain nodes and their circles when knowledge units are off", () => {
    const filtered = applyFilters(graph, {
      ...ALL_LAYERS,
      shown: { unit: false, entity: false, domain: true, page: false },
      showOrphans: false,
    });
    expect(filtered.nodes.map((node) => node.id).sort()).toEqual(["d1", "d2"]);
    expect(
      filtered.nodes.find((node) => node.id === "d1")?.domainPaths,
    ).toEqual(["Projects/Alpha"]);
    const grouped = graphForGrouping(filtered, "domain");
    expect(grouped.nodes.map((node) => node.id).sort()).toEqual(["d1", "d2"]);
    const placed = grouped.nodes.map((node) => ({ ...node, x: 0, y: 0 }));
    expect(
      clusterCircles(placed, 1, "domain")
        .map((circle) => circle.key)
        .sort(),
    ).toEqual(["Projects", "Projects/Alpha", "Projects/Alpha/Data layer"]);
  });

  it("keeps domain hub nodes when grouping by domain circles", () => {
    const grouped = graphForGrouping(graph, "domain");
    expect(grouped.nodes.map((node) => node.id).sort()).toEqual([
      "d1",
      "d2",
      "e1",
      "p1",
      "u1",
      "u2",
      "u3",
    ]);
    expect(grouped.links.some((link) => link.kind === "in")).toBe(true);
    expect(graphForGrouping(graph, "off")).toBe(graph);
  });

  it("hides connector lines without removing the nodes they join", () => {
    const hidden = applyFilters(graph, {
      ...ALL_LAYERS,
      showConnectors: false,
    });
    expect(hidden.nodes.map((node) => node.id).sort()).toEqual([
      "d1",
      "d2",
      "e1",
      "p1",
      "u1",
      "u2",
      "u3",
    ]);
    expect(hidden.links.some((link) => link.kind === "in")).toBe(false);
    expect(hidden.links.some((link) => link.kind === "about")).toBe(false);
    expect(hidden.links.some((link) => link.kind === "cites")).toBe(false);
    expect(hidden.links.some((link) => link.kind === "depends_on")).toBe(true);
  });

  it("keeps page dots and their cites lines so each page sits in the middle of its circle", () => {
    expect(nodeById("u1").pageTitles).toEqual(["Alpha"]);
    const grouped = graphForGrouping(graph, "page");
    expect(grouped.nodes.map((node) => node.id)).toContain("p1");
    expect(grouped.links.some((link) => link.kind === "cites")).toBe(true);
    expect(grouped.links.some((link) => link.kind === "depends_on")).toBe(true);
  });
});

describe("entity homes", () => {
  const node = (
    id: string,
    kind: GraphNode["kind"],
    extra: Partial<GraphNode> = {},
  ): GraphNode => ({
    id,
    kind,
    label: id,
    text: "",
    href: "/",
    createdAt: T1,
    degree: 0,
    domainPaths: [],
    entityNames: [],
    pageTitles: [],
    unitKind: null,
    status: null,
    ...extra,
  });
  const acme = node("e1", "entity", { entityNames: ["Acme"] });
  const evidence = {
    nodes: [
      acme,
      node("u1", "unit", {
        domainPaths: ["Safety"],
        entityNames: ["Acme"],
        pageTitles: ["Alpha"],
        pageSections: [{ page: "Alpha", section: "Intro", position: 0 }],
      }),
      node("u2", "unit", {
        domainPaths: ["Quality"],
        entityNames: ["Acme"],
        pageTitles: ["Beta"],
        pageSections: [{ page: "Beta", section: "Rules", position: 1 }],
      }),
      node("u3", "unit", {
        domainPaths: ["Quality"],
        entityNames: ["Acme"],
        pageTitles: ["Beta"],
        pageSections: [{ page: "Beta", section: "Rules", position: 1 }],
      }),
      node("u4", "unit", { domainPaths: ["Safety"], entityNames: ["Other"] }),
    ],
    links: [],
  };
  // Units hidden: only the entity is visible, the evidence still has its units
  const entityOnly = { nodes: [acme], links: [] };

  it("puts an entity in the domain most of its units sit in", () => {
    const grouped = graphForGrouping(entityOnly, "domain", evidence);
    expect(grouped.nodes.find((item) => item.id === "e1")?.domainPaths).toEqual(
      ["Quality"],
    );
  });

  it("puts an entity in the article and section that cite most of its units", () => {
    const grouped = graphForGrouping(entityOnly, "page", evidence);
    const placed = grouped.nodes.find((item) => item.id === "e1");
    expect(placed?.pageTitles).toEqual(["Beta"]);
    expect(placed?.pageSections).toEqual([
      { page: "Beta", section: "Rules", position: 1 },
    ]);
  });

  it("leaves the entity in place in its own grouping", () => {
    const grouped = graphForGrouping(entityOnly, "entity", evidence);
    expect(grouped.nodes).toEqual([acme]);
  });

  // Beta cites u2 and u3, both about Acme in Quality
  const beta = node("p2", "page", { pageTitles: ["Beta"] });
  const pagesOnly = { nodes: [beta], links: [] };
  const withPage = { ...evidence, nodes: [...evidence.nodes, beta] };

  it("puts a page with no entity in the entity most of its cited units are about", () => {
    const grouped = graphForGrouping(pagesOnly, "entity", withPage);
    expect(grouped.nodes[0]?.entityNames).toEqual(["Acme"]);
  });

  it("puts a page with no domain in the domain most of its cited units sit in", () => {
    const grouped = graphForGrouping(pagesOnly, "domain", withPage);
    expect(grouped.nodes[0]?.domainPaths).toEqual(["Quality"]);
  });

  it("keeps a page's own domain and entity", () => {
    const owned = node("p2", "page", {
      pageTitles: ["Beta"],
      domainPaths: ["Safety"],
      entityNames: ["Other"],
    });
    const data = { nodes: [owned], links: [] };
    expect(graphForGrouping(data, "domain", withPage).nodes).toEqual([owned]);
    expect(graphForGrouping(data, "entity", withPage).nodes).toEqual([owned]);
  });
});

describe("domain clusters", () => {
  const dot = (
    id: string,
    domainPaths: string[],
    x = 0,
    y = 0,
    entityNames: string[] = [],
    kind: GraphNode["kind"] = "unit",
  ): SimNode => ({
    ...({} as GraphNode),
    id,
    kind,
    domainPaths,
    entityNames,
    degree: kind === "domain" ? 12 : 0,
    x,
    y,
  });
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  it("does not change a domain circle when the domain node is added", () => {
    const units = Array.from({ length: 8 }, (_, i) =>
      dot(`u${i}`, ["Co/Safety/PPE"]),
    );
    const without = clusterCircles(units, 1, "domain");
    const withNode = clusterCircles(
      [...units, dot("d", ["Co/Safety/PPE"], 0, 0, [], "domain")],
      1,
      "domain",
    );
    const before = without.find((circle) => circle.key === "Co/Safety/PPE")!;
    const after = withNode.find((circle) => circle.key === "Co/Safety/PPE")!;
    expect(after.r).toBe(before.r);
  });

  it("grows a domain circle so the domain bubble fits inside", () => {
    const note = dot("u", ["Co/Safety/PPE"]);
    const hub = dot("d", ["Co/Safety/PPE"], 0, 0, [], "domain");
    hub.degree = 80;
    const before = clusterCircles([note], 1, "domain").find(
      (circle) => circle.key === "Co/Safety/PPE",
    )!;
    const after = clusterCircles([note, hub], 1, "domain").find(
      (circle) => circle.key === "Co/Safety/PPE",
    )!;
    expect(after.r).toBeGreaterThan(before.r);
    expect(after.r).toBeGreaterThanOrEqual(nodeRadius(hub, 1) + 8);
  });

  it("grows the circle again when the domain bubble sits off center", () => {
    const hub = dot("d", ["Co/Topic"], 0, 0, [], "domain");
    hub.degree = 40;
    const note = dot("a", ["Co/Topic"], 80, 0);
    note.fx = 80;
    note.fy = 0;
    const nodes = [hub, note];
    const links = [{ source: note.id, target: hub.id }];
    createContainment(nodes, 1, "domain", links)();
    const circle = packDomains(nodes, 1, "domain", links).circles.find(
      (item) => item.key === "Co/Topic",
    )!;
    const edge =
      Math.hypot((hub.x ?? 0) - circle.x, (hub.y ?? 0) - circle.y) +
      nodeRadius(hub, 1);
    expect(circle.r).toBeGreaterThanOrEqual(edge + 8 - 0.01);
  });

  it("pins a parent domain hub at the center of that circle", () => {
    const hub = dot("d-parent", ["Co/Safety"], 40, -20, [], "domain");
    const nodes = [
      hub,
      dot("a", ["Co/Safety/PPE"]),
      dot("b", ["Co/Safety/Training"]),
    ];
    createContainment(nodes, 1, "domain")();
    const { circles, homes } = packDomains(nodes, 1, "domain");
    const circle = circles.find((item) => item.key === "Co/Safety")!;
    const home = homes.get("d-parent")!;
    expect(home.pin).toBe(true);
    expect(home.x).toBe(circle.x);
    expect(home.y).toBe(circle.y);
    expect(
      Math.hypot((hub.x ?? 0) - home.x, (hub.y ?? 0) - home.y),
    ).toBeLessThan(home.r);
  });

  it("moves overlapping domain nodes apart without leaving a note inside one", () => {
    const left = dot("d-a", ["Co/A"], 0, 0, [], "domain");
    const right = dot("d-b", ["Co/B"], 0, 0, [], "domain");
    left.degree = 40;
    right.degree = 40;
    const note = dot("u", ["Co/A"]);
    const nodes = [left, right, note];
    createContainment(nodes, 1, "domain")();
    expect(Math.hypot(left.x! - right.x!, left.y! - right.y!)).toBeGreaterThan(
      nodeRadius(left, 1) + nodeRadius(right, 1) - 0.5,
    );
    expect(Math.hypot(note.x! - left.x!, note.y! - left.y!)).toBeGreaterThan(
      nodeRadius(note, 1) + nodeRadius(left, 1) - 0.5,
    );
  });

  it("places a parent domain between its child circles", () => {
    const parent = dot("p", ["Co/Safety"], 0, 0, [], "domain");
    const notes = [
      dot("a", ["Co/Safety/PPE"]),
      dot("b", ["Co/Safety/Training"]),
    ];
    const nodes = [parent, ...notes];
    createContainment(nodes, 1, "domain")();
    const children = packDomains(nodes, 1, "domain").circles.filter(
      (circle) => circle.parent === "Co/Safety",
    );
    const midX =
      children.reduce((sum, circle) => sum + circle.x, 0) / children.length;
    const midY =
      children.reduce((sum, circle) => sum + circle.y, 0) / children.length;
    expect(parent.x).toBeCloseTo(midX);
    expect(parent.y).toBeCloseTo(midY);
  });

  it("places a domain node in the middle of the notes it connects to", () => {
    const hub = dot("d", ["Co/Topic"], 400, 400, [], "domain");
    const notes = [
      dot("a", ["Co/Topic"], 0, 0),
      dot("b", ["Co/Topic"], 120, 0),
      dot("c", ["Co/Topic"], 0, 90),
    ];
    for (const note of notes) {
      note.fx = note.x;
      note.fy = note.y;
    }
    createContainment(
      [hub, ...notes],
      1,
      "domain",
      notes.map((note) => ({ source: note.id, target: hub.id })),
    )();
    expect(hub.x).toBeCloseTo(40);
    expect(hub.y).toBeCloseTo(30);
  });

  it("lets a connection outside the domain pull less than one inside it", () => {
    const hub = dot("d", ["Co/Topic"], 0, 0, [], "domain");
    const inside = dot("in", ["Co/Topic"], 0, 0);
    const outside = dot("out", ["Co/Other"], 100, 0);
    inside.fx = 0;
    inside.fy = 0;
    outside.fx = 100;
    outside.fy = 0;
    createContainment([hub, inside, outside], 1, "domain", [
      { source: inside.id, target: hub.id },
      { source: outside.id, target: hub.id },
    ])();
    expect(hub.x).toBeCloseTo((100 * 0.03) / 1.03);
    expect(hub.y).toBeCloseTo(0);
  });

  it("pins the domain hub at the center of its topic circle", () => {
    const hub = dot("d-leaf", ["Co/Safety/PPE"], 99, 99, [], "domain");
    const units = Array.from({ length: 8 }, (_, i) =>
      dot(`u${i}`, ["Co/Safety/PPE"]),
    );
    const nodes = [...units, hub];
    createContainment(nodes, 1, "domain")();
    const { homes } = packDomains(nodes, 1, "domain");
    const home = homes.get("d-leaf")!;
    expect(home.pin).toBe(true);
    expect(Math.hypot((hub.x ?? 0) - 99, (hub.y ?? 0) - 99)).toBeGreaterThan(1);
    expect(
      Math.hypot((hub.x ?? 0) - home.x, (hub.y ?? 0) - home.y),
    ).toBeLessThan(home.r);
  });

  it("names the circles and dots a selected group links to", () => {
    const nodes = [
      dot("a", ["Types/One"]),
      dot("b", ["Types/One"]),
      dot("c", ["Types/Six/Fear"]),
      dot("d", ["Types/Six/Fear"]),
      dot("e", ["Other"]),
      dot("loose", []),
    ];
    const found = clusterConnections(
      nodes,
      [
        { source: "a", target: "c" },
        { source: "a", target: "b" },
        { source: "d", target: "e" },
        { source: "a", target: "loose" },
      ],
      "Types/One",
      "domain",
    );
    expect([...found.nodeIds].sort()).toEqual(["c", "loose"]);
    expect([...found.circleKeys].sort()).toEqual([
      "Types/Six",
      "Types/Six/Fear",
    ]);
    const entities = clusterConnections(
      [dot("a", [], 0, 0, ["Threes"]), dot("b", [], 0, 0, ["Eights"])],
      [{ source: "a", target: "b" }],
      "Threes",
      "entity",
    );
    expect([...entities.nodeIds]).toEqual(["b"]);
    expect([...entities.circleKeys]).toEqual(["Eights"]);
  });

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

  it("opens an article, section, or suggestion from a second click", () => {
    expect(circleOpenTarget({ label: "Alpha", parent: "" }, "page")).toEqual({
      kind: "page",
      title: "Alpha",
    });
    expect(
      circleOpenTarget({ label: "Facts", parent: "Alpha" }, "page"),
    ).toEqual({ kind: "section", page: "Alpha", section: "Facts" });
    expect(
      circleOpenTarget({ label: "Centers", parent: NO_ARTICLE_LABEL }, "page"),
    ).toEqual({ kind: "recommendation", title: "Centers" });
    expect(
      circleOpenTarget({ label: NO_ARTICLE_LABEL, parent: "" }, "page"),
    ).toBeNull();
    expect(
      circleOpenTarget({ label: "Alpha", parent: "" }, "domain"),
    ).toBeNull();
  });

  it("gathers units that no article cites into a No article circle", () => {
    const cited = { ...dot("a", []), pageTitles: ["Alpha"] };
    const loose = { ...dot("b", []), pageTitles: [] as string[] };
    const hub = dot("d", ["Co/Topic"], 0, 0, [], "domain");
    const circles = clusterCircles([cited, loose, hub], 1, "page");
    expect(circles.map((circle) => circle.label)).toEqual([
      "Alpha",
      NO_ARTICLE_LABEL,
      ORPHANS_LABEL,
    ]);
    const catchAll = circles.find(
      (circle) => circle.label === NO_ARTICLE_LABEL,
    )!;
    const orphans = circles.find((circle) => circle.label === ORPHANS_LABEL)!;
    expect(catchAll.color).toBe("muted");
    expect(orphans.parent).toBe(NO_ARTICLE_LABEL);
    const { homes } = packDomains([cited, loose, hub], 1, "page");
    expect(homes.get("b")).toEqual({
      x: orphans.x,
      y: orphans.y,
      r: orphans.r - 8,
    });
    expect(homes.has("d")).toBe(false);
    expect(nodeInCluster(loose, NO_ARTICLE_LABEL, "page")).toBe(true);
    expect(nodeInCluster(hub, NO_ARTICLE_LABEL, "page")).toBe(false);
    expect(nodeInCluster(cited, "Alpha", "page")).toBe(true);
    const found = clusterConnections(
      [cited, loose],
      [{ source: "a", target: "b" }],
      "Alpha",
      "page",
    );
    expect([...found.circleKeys]).toEqual([NO_ARTICLE_LABEL]);
  });

  it("nests the most-connected No article node with the nodes it links", () => {
    const center = {
      ...dot("hub", []),
      pageTitles: [] as string[],
      degree: 6,
    };
    const leaf = {
      ...dot("leaf", []),
      pageTitles: [] as string[],
      degree: 1,
    };
    const alone = {
      ...dot("alone", []),
      pageTitles: [] as string[],
      degree: 0,
    };
    const links = [{ source: "hub", target: "leaf" }];
    const circles = clusterCircles([center, leaf, alone], 1, "page", links);
    const outer = circles.find((circle) => circle.label === NO_ARTICLE_LABEL)!;
    expect(outer.quiet).toBeUndefined();
    const nested = circles.find((circle) => circle.quiet);
    expect(nested?.parent).toBe(NO_ARTICLE_LABEL);
    expect(nested?.label).toBe("hub");
    const { homes } = packDomains([center, leaf, alone], 1, "page", links);
    expect(homes.get("hub")).toBe(homes.get("leaf"));
    expect(homes.get("alone")).not.toBe(homes.get("hub"));
  });

  it("groups leftover linked No article nodes without borrowing a claim title", () => {
    const big = {
      ...dot("big", []),
      pageTitles: [] as string[],
      degree: 3,
      label: "Formatory apparatus",
    };
    const other = {
      ...dot("other", []),
      pageTitles: [] as string[],
      degree: 1,
      label: "Six",
    };
    const links = [
      { source: "big", target: "outside-a" },
      { source: "other", target: "outside-b" },
    ];
    const circles = clusterCircles([big, other], 1, "page", links);
    const group = circles.find((circle) => circle.label === LINKED_LABEL)!;
    expect(group.parent).toBe(NO_ARTICLE_LABEL);
    expect(group.quiet).toBeUndefined();
    expect(group.badge).toBeUndefined();
    expect(group.color).toBe("muted");
    expect(
      circleOpenTarget(
        { label: LINKED_LABEL, parent: NO_ARTICLE_LABEL },
        "page",
      ),
    ).toBeNull();
    const { homes } = packDomains([big, other], 1, "page", links);
    expect(homes.get("big")).toBe(homes.get("other"));
    expect(
      pageMoveTarget(
        { ...dot("claim", []), pageTitles: ["Alpha"] },
        { key: group.key, label: LINKED_LABEL, parent: NO_ARTICLE_LABEL },
        null,
      ),
    ).toBeNull();
  });

  it("separates No article orphans from units with an external source", () => {
    const orphan = {
      ...dot("orphan", []),
      pageTitles: [] as string[],
      degree: 0,
    };
    const external = {
      ...dot("web", []),
      pageTitles: [] as string[],
      degree: 0,
      sourceScopes: ["external" as const],
    };
    const hub = { ...dot("hub", []), pageTitles: [] as string[], degree: 4 };
    const leaf = { ...dot("leaf", []), pageTitles: [] as string[], degree: 1 };
    const linkedOut = {
      ...dot("out", []),
      pageTitles: [] as string[],
      degree: 1,
    };
    const nodes = [orphan, external, hub, leaf, linkedOut];
    const links = [
      { source: "hub", target: "leaf" },
      { source: "out", target: "cited-unit" },
    ];
    const circles = clusterCircles(nodes, 1, "page", links);
    const orphans = circles.find((circle) => circle.label === ORPHANS_LABEL)!;
    const outside = circles.find((circle) => circle.label === EXTERNAL_LABEL)!;
    expect(orphans.parent).toBe(NO_ARTICLE_LABEL);
    expect(orphans.quiet).toBeUndefined();
    expect(orphans.badge).toBeUndefined();
    expect(outside.parent).toBe(NO_ARTICLE_LABEL);
    expect(outside.color).toBe("graph-teal");
    expect(outside.badge).toBeUndefined();
    expect(
      circleOpenTarget(
        { label: ORPHANS_LABEL, parent: NO_ARTICLE_LABEL },
        "page",
      ),
    ).toBeNull();
    expect(
      circleOpenTarget(
        { label: EXTERNAL_LABEL, parent: NO_ARTICLE_LABEL },
        "page",
      ),
    ).toBeNull();
    const { homes } = packDomains(nodes, 1, "page", links);
    expect(homes.get("orphan")).not.toBe(homes.get("web"));
    expect(homes.get("out")).not.toBe(homes.get("orphan"));
    expect(homes.get("hub")).toBe(homes.get("leaf"));
    expect(
      pageMoveTarget(
        { ...dot("claim", []), pageTitles: ["Alpha"] },
        {
          key: orphans.key,
          label: ORPHANS_LABEL,
          parent: NO_ARTICLE_LABEL,
        },
        null,
      ),
    ).toBeNull();
  });

  it("groups a pending article suggestion inside No article in orange", () => {
    const loose = { ...dot("a", []), pageTitles: [] as string[] };
    const recommended = {
      ...dot("b", []),
      pageTitles: [] as string[],
      recommendedTitle: "Centers",
      recommendedKind: "merge" as const,
    };
    const created = {
      ...dot("d", []),
      pageTitles: [] as string[],
      recommendedTitle: "Wings",
      recommendedKind: "create" as const,
    };
    const cited = {
      ...dot("c", []),
      pageTitles: ["Alpha"],
      recommendedTitle: "Centers",
    };
    const circles = clusterCircles(
      [loose, recommended, created, cited],
      1,
      "page",
    );
    const suggestion = circles.find((circle) => circle.label === "Centers")!;
    const createdCircle = circles.find((circle) => circle.label === "Wings")!;
    expect(suggestion.parent).toBe(NO_ARTICLE_LABEL);
    expect(suggestion.color).toBe("needs-you");
    expect(suggestion.badge).toBe("Merge");
    expect(createdCircle.color).toBe("link");
    expect(createdCircle.badge).toBe("New Article");
    expect(
      circles.find((circle) => circle.label === NO_ARTICLE_LABEL)!.color,
    ).toBe("muted");
    expect(nodeInCluster(recommended, NO_ARTICLE_LABEL, "page")).toBe(true);
    expect(nodeInCluster(loose, suggestion.key, "page")).toBe(false);
    expect(nodeInCluster(cited, "Alpha", "page")).toBe(true);
    const built = buildGraph({
      ...rows,
      suggestions: [
        {
          id: "s-b",
          title: "Beta group",
          kind: "create",
          status: "pending",
          unit_ids: ["u3"],
        },
        {
          id: "s-a",
          title: "Alpha group",
          kind: "merge",
          status: "pending",
          unit_ids: ["u3", "u2"],
        },
        {
          id: "s-old",
          title: "Dismissed",
          status: "dismissed",
          unit_ids: ["u2"],
        },
      ],
    });
    expect(built.nodes.find((node) => node.id === "u3")!.recommendedTitle).toBe(
      "Alpha group",
    );
    expect(built.nodes.find((node) => node.id === "u2")!.recommendedTitle).toBe(
      "Alpha group",
    );
    expect(built.nodes.find((node) => node.id === "u2")!.recommendedKind).toBe(
      "merge",
    );
    expect(
      built.nodes.find((node) => node.id === "u1")!.recommendedTitle,
    ).toBeUndefined();
  });

  it("nests each section inside its article and keeps that section's units there", () => {
    const placed = (
      id: string,
      section: string,
      position: number,
    ): SimNode => ({
      ...dot(id, []),
      pageTitles: ["Alpha"],
      pageSections: [{ page: "Alpha", section, position }],
    });
    const early = placed("early", "Zebra", 0);
    const later = placed("later", "Apple", 1);
    const both = {
      ...placed("both", "Zebra", 0),
      pageSections: [
        { page: "Alpha", section: "Zebra", position: 0 },
        { page: "Alpha", section: "Apple", position: 1 },
      ],
    };
    const circles = clusterCircles([early, later, both], 1, "page");
    expect(circles.map((circle) => circle.label)).toEqual([
      "Alpha",
      "Zebra",
      "Apple",
    ]);
    const article = circles[0]!;
    const zebra = circles[1]!;
    const apple = circles[2]!;
    expect(article.isBranch).toBe(true);
    expect(zebra.parent).toBe(article.key);
    expect(circleNestedIn(zebra.key, article.key, "page")).toBe(true);
    expect(zebra.color).toBe(entityColor("Alpha"));
    expect(apple.color).toBe(entityColor("Alpha"));
    expect(nodeInCluster(early, article.key, "page")).toBe(true);
    expect(nodeInCluster(early, zebra.key, "page")).toBe(true);
    expect(nodeInCluster(early, apple.key, "page")).toBe(false);
    expect(nodeInCluster(both, zebra.key, "page")).toBe(true);
    expect(nodeInCluster(both, apple.key, "page")).toBe(false);
    const { homes } = packDomains([early, later, both], 1, "page");
    const home = homes.get("early")!;
    expect(home.x).toBeCloseTo(zebra.x);
    expect(home.y).toBeCloseTo(zebra.y);
    expect(distance(home, article)).toBeLessThan(article.r);
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

  it("files a claim into an article, a section, or a suggestion", () => {
    const claim = {
      kind: "unit" as const,
      pageTitles: ["Alpha"],
      pageSections: [{ page: "Alpha", section: "Facts", position: 0 }],
    };
    const facts = {
      key: pageSectionKey("Alpha", "Facts"),
      label: "Facts",
      parent: "Alpha",
    };
    const notes = {
      key: pageSectionKey("Beta", "Notes"),
      label: "Notes",
      parent: "Beta",
    };
    expect(pageMoveTarget(claim, facts, null)).toBeNull();
    expect(pageMoveTarget(claim, notes, null)).toEqual({
      kind: "section",
      page: "Beta",
      section: "Notes",
    });
    expect(
      pageMoveTarget(claim, { key: "Beta", label: "Beta", parent: "" }, null),
    ).toEqual({ kind: "article", page: "Beta" });
    expect(
      pageMoveTarget(claim, { key: "Alpha", label: "Alpha", parent: "" }, null),
    ).toBeNull();
    expect(
      pageMoveTarget(
        claim,
        { key: NO_ARTICLE_LABEL, label: NO_ARTICLE_LABEL, parent: "" },
        null,
      ),
    ).toBeNull();
    expect(
      pageMoveTarget(
        claim,
        {
          key: pageSectionKey(NO_ARTICLE_LABEL, "Centers"),
          label: "Centers",
          parent: NO_ARTICLE_LABEL,
          badge: "Merge",
        },
        null,
      ),
    ).toEqual({ kind: "suggestion", title: "Centers", merge: true });
    expect(pageMoveTarget(claim, notes, "Alpha")).toBeNull();
    expect(
      pageMoveTarget(
        claim,
        {
          key: pageSectionKey("Alpha", "Notes"),
          label: "Notes",
          parent: "Alpha",
        },
        "Alpha",
      ),
    ).toEqual({ kind: "section", page: "Alpha", section: "Notes" });
    expect(pageMoveTarget({ ...claim, kind: "page" }, notes, null)).toBeNull();
    const loose = {
      kind: "unit" as const,
      pageTitles: [] as string[],
      recommendedTitle: "Wings",
      recommendedKind: "create" as const,
    };
    expect(
      pageMoveTarget(
        loose,
        {
          key: pageSectionKey(NO_ARTICLE_LABEL, "Wings"),
          label: "Wings",
          parent: NO_ARTICLE_LABEL,
          badge: "New Article",
        },
        null,
      ),
    ).toBeNull();
    expect(
      pageDropLabel({ kind: "section", page: "Beta", section: "Notes" }),
    ).toBe("Notes in Beta");
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

  it("names a bigger, fuller group in larger type, never below the note titles it holds", () => {
    expect(groupLabelPx(100, 100, 40, 40, 12, 32)).toBe(32);
    expect(groupLabelPx(0, 100, 0, 40, 12, 32)).toBe(12);
    expect(groupLabelPx(10, 0, 4, 0, 12, 32)).toBe(32);
    expect(groupLabelPx(50, 100, 20, 40, 12, 32)).toBeGreaterThan(
      groupLabelPx(25, 100, 10, 40, 12, 32),
    );
    expect(groupLabelPx(40, 100, 30, 40, 12, 32)).toBeGreaterThan(
      groupLabelPx(40, 100, 4, 40, 12, 32),
    );
    expect(groupLabelPx(80, 100, 10, 40, 12, 32)).toBeGreaterThan(
      groupLabelPx(20, 100, 10, 40, 12, 32),
    );
  });
});
