import type { GraphData, GraphLink, GraphNode, GraphNodeKind } from "./types";

// =====================================================================
// FILTERS (Obsidian's Filters section): which nodes show. Order:
// domain, then layer toggles, then search, then orphans, so a node
// left without visible links by the first three counts as an orphan.
// =====================================================================

export interface GraphFilters {
  domainScope: "internal" | "external" | "both" | "none";
  search: string;
  // one domain path to focus on, with every subdomain below it ("" = all domains)
  domain: string;
  showUnits: boolean;
  showEntities: boolean;
  showDomains: boolean;
  showPages: boolean;
  showOrphans: boolean;
  // Lines that attach a note to a domain, entity, or page
  showConnectors: boolean;
  // Stored lines between notes (supports, related to, and the rest). Zoomed out, these draw as the thin lines between circles.
  showRelationships: boolean;
  // derived "similar" links between related units, and the minimum score (0..1) they need
  showRelated: boolean;
  relatedness: number;
}

// Keeps the links whose two ends are both in `ids`
function linksWithin(
  data: GraphData,
  ids: ReadonlySet<string>,
): GraphData["links"] {
  return data.links.filter(
    (link) => ids.has(link.source) && ids.has(link.target),
  );
}

// Keeps the nodes that pass `keep`, and the links between them
export function keepNodes(
  data: GraphData,
  keep: (node: GraphData["nodes"][number]) => boolean,
): GraphData {
  const nodes = data.nodes.filter(keep);
  const ids = new Set(nodes.map((node) => node.id));
  return { nodes, links: linksWithin(data, ids) };
}

const CONNECTOR_KINDS = new Set(["in", "about", "cites"]);

function applyConnectors(data: GraphData, show: boolean): GraphData {
  if (show) return data;
  return {
    nodes: data.nodes,
    links: data.links.filter((link) => !CONNECTOR_KINDS.has(link.kind)),
  };
}

function isRelationship(kind: GraphLink["kind"]): boolean {
  return (
    kind !== "about" && kind !== "cites" && kind !== "in" && kind !== "similar"
  );
}

function applyRelationships(data: GraphData, show: boolean): GraphData {
  if (show) return data;
  return {
    nodes: data.nodes,
    links: data.links.filter((link) => !isRelationship(link.kind)),
  };
}

// Ids of the nodes that touch at least one link
function linkedIds(data: GraphData): Set<string> {
  return new Set(data.links.flatMap((link) => [link.source, link.target]));
}

// DOMAIN FOCUS: units and pages in `domain` or a subdomain below it. Entities have no
// domain of their own, so one stays when it links to something kept. Domain hubs stay
// when their path matches or when they link to something kept.
export function inDomain(data: GraphData, domain: string): GraphData {
  const focus = domain.trim().replace(/\/+$/, "").toLowerCase();
  if (!focus) return data;
  const matches = (path: string) => {
    const lower = path.toLowerCase();
    return lower === focus || lower.startsWith(`${focus}/`);
  };
  const matched = new Set(
    data.nodes
      .filter((node) => node.domainPaths.some(matches))
      .map((node) => node.id),
  );
  const linked = new Set(
    data.links.flatMap((link) =>
      matched.has(link.source)
        ? [link.target]
        : matched.has(link.target)
          ? [link.source]
          : [],
    ),
  );
  return keepNodes(
    data,
    (node) =>
      matched.has(node.id) ||
      ((node.kind === "entity" || node.kind === "domain") &&
        linked.has(node.id)),
  );
}

export function domainPathsForScope(
  node: GraphNode,
  scope: GraphFilters["domainScope"],
): string[] {
  const internal = node.domainScopePaths?.internal ?? node.domainPaths;
  const external = node.domainScopePaths?.external ?? [];
  if (scope === "none") return [];
  if (scope === "both") return [...new Set([...internal, ...external])];
  return scope === "internal" ? internal : external;
}

// Entities and domain hubs follow connected notes; notes without domains still follow source origin.
export function inDomainScope(
  data: GraphData,
  scope: GraphFilters["domainScope"],
): GraphData {
  const matched = new Set(
    data.nodes
      .filter(
        (node) =>
          node.kind !== "entity" &&
          node.kind !== "domain" &&
          (node.sourceScopes
            ? node.sourceScopes.some(
                (origin) => scope === "both" || scope === origin,
              )
            : domainPathsForScope(node, scope).length > 0 ||
              ((scope === "internal" || scope === "both") &&
                node.domainPaths.length === 0)),
      )
      .map((node) => node.id),
  );
  const linked = new Set(
    data.links.flatMap((link) =>
      matched.has(link.source)
        ? [link.target]
        : matched.has(link.target)
          ? [link.source]
          : [],
    ),
  );
  const scoped = keepNodes(
    data,
    (node) =>
      matched.has(node.id) ||
      ((node.kind === "entity" || node.kind === "domain") &&
        linked.has(node.id)),
  );
  return {
    ...scoped,
    nodes: scoped.nodes.map((node) => ({
      ...node,
      // A domain node is the topic itself. Scope filters notes, not the topic path.
      domainPaths:
        node.kind === "domain"
          ? node.domainPaths
          : domainPathsForScope(node, scope),
    })),
  };
}

// Entity grouping hides domain hubs when the Domains filter is off. Put back hubs for topics the visible units use.
export function mergeEntityDomainHubs(
  filtered: GraphData,
  source: GraphData,
): GraphData {
  const paths = new Set<string>();
  for (const node of filtered.nodes) {
    if (node.kind !== "unit" && node.kind !== "page") continue;
    for (const path of node.domainPaths) paths.add(path);
  }
  if (paths.size === 0) return filtered;
  const domainByPath = new Map(
    source.nodes
      .filter((node) => node.kind === "domain" && node.domainPaths[0])
      .map((node) => [node.domainPaths[0]!, node]),
  );
  const byId = new Map(filtered.nodes.map((node) => [node.id, node]));
  for (const path of paths) {
    const domain = domainByPath.get(path);
    if (domain && !byId.has(domain.id)) byId.set(domain.id, domain);
  }
  const nodes = [...byId.values()];
  const ids = new Set(nodes.map((node) => node.id));
  const seen = new Set(filtered.links.map((link) => link.id));
  const links = [...filtered.links];
  for (const link of source.links) {
    if (link.kind !== "in" || seen.has(link.id)) continue;
    if (!ids.has(link.source) || !ids.has(link.target)) continue;
    links.push(link);
    seen.add(link.id);
  }
  return { nodes, links };
}

// The name used most often on a topic. Ties keep the name that sorts first.
function preferredName(
  counts: ReadonlyMap<string, number> | undefined,
): string | null {
  let best: string | null = null;
  let bestCount = -1;
  if (!counts) return null;
  for (const [name, count] of counts) {
    if (count <= 0) continue;
    if (
      best === null ||
      count > bestCount ||
      (count === bestCount && name.localeCompare(best) < 0)
    ) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

function topicPaths(nodes: readonly GraphNode[]): string[] {
  return [
    ...new Set(
      nodes
        .filter((node) => node.kind === "domain")
        .map((node) => node.domainPaths[0] ?? "")
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

// Parent topics, child topics, and links between their notes. About, in, cites,
// and similar lines are not bridges: the group counts already used those.
function topicNeighbors(
  domainPaths: readonly string[],
  evidenceNodes: readonly GraphNode[],
  evidenceLinks: readonly GraphLink[],
): Map<string, Map<string, number>> {
  const pathsOf = new Map<string, readonly string[]>();
  for (const node of evidenceNodes) {
    if (node.kind === "domain" || node.kind === "entity") continue;
    pathsOf.set(node.id, node.domainPaths);
  }
  const neighbors = new Map<string, Map<string, number>>();
  const connect = (left: string, right: string) => {
    if (!left || !right || left === right) return;
    const row = neighbors.get(left) ?? new Map<string, number>();
    row.set(right, (row.get(right) ?? 0) + 1);
    neighbors.set(left, row);
  };
  for (const path of domainPaths) {
    const parent = path.split("/").slice(0, -1).join("/");
    if (!parent) continue;
    connect(path, parent);
    connect(parent, path);
  }
  for (const link of evidenceLinks) {
    if (
      link.kind === "about" ||
      link.kind === "in" ||
      link.kind === "cites" ||
      link.kind === "similar"
    )
      continue;
    const left = pathsOf.get(link.source);
    const right = pathsOf.get(link.target);
    if (!left || !right) continue;
    for (const sourcePath of left) {
      for (const targetPath of right) {
        connect(sourcePath, targetPath);
        connect(targetPath, sourcePath);
      }
    }
  }
  return neighbors;
}

// A topic with no group of its own takes the group of the topic it connects to most.
function spreadTopicGroups<T>(
  domainPaths: readonly string[],
  neighbors: ReadonlyMap<string, ReadonlyMap<string, number>>,
  assigned: Map<string, T>,
  closer: (candidate: T, current: T) => boolean,
): void {
  let pending = domainPaths.filter((path) => !assigned.has(path));
  for (let hop = 0; hop < domainPaths.length && pending.length > 0; hop++) {
    const next: string[] = [];
    for (const path of pending) {
      const row = neighbors.get(path);
      let best: T | undefined;
      let bestWeight = -1;
      if (row) {
        for (const [other, weight] of row) {
          const value = assigned.get(other);
          if (value === undefined) continue;
          if (
            best === undefined ||
            weight > bestWeight ||
            (weight === bestWeight && closer(value, best))
          ) {
            best = value;
            bestWeight = weight;
          }
        }
      }
      if (best !== undefined) assigned.set(path, best);
      else next.push(path);
    }
    if (next.length === pending.length) break;
    pending = next;
  }
}

// Each domain hub joins the entity that shares the most claims in that topic.
// A topic with no entity of its own joins the topic it connects to most.
function domainsInsideEntityGroups(
  nodes: readonly GraphNode[],
  evidenceNodes: readonly GraphNode[] = nodes,
  evidenceLinks: readonly GraphLink[] = [],
): GraphNode[] {
  const shared = new Map<string, Map<string, number>>();
  for (const node of evidenceNodes) {
    if (
      node.kind === "domain" ||
      node.kind === "entity" ||
      node.entityNames.length === 0
    )
      continue;
    for (const path of node.domainPaths) {
      const counts = shared.get(path) ?? new Map<string, number>();
      for (const name of node.entityNames)
        counts.set(name, (counts.get(name) ?? 0) + 1);
      shared.set(path, counts);
    }
  }
  const assigned = new Map<string, string>();
  for (const [path, counts] of shared) {
    const name = preferredName(counts);
    if (name) assigned.set(path, name);
  }
  const domainPaths = topicPaths(nodes);
  spreadTopicGroups(
    domainPaths,
    topicNeighbors(domainPaths, evidenceNodes, evidenceLinks),
    assigned,
    (candidate, current) => candidate.localeCompare(current) < 0,
  );
  return nodes.map((node) => {
    if (node.kind !== "domain") return node;
    const name = assigned.get(node.domainPaths[0] ?? "");
    return name ? { ...node, entityNames: [name] } : node;
  });
}

interface PageHome {
  page: string;
  section: string | null;
  position: number;
}

// The section this note uses on one article. Several sections keep the earliest.
function homeSection(
  node: GraphNode,
  page: string,
): { section: string; position: number } | null {
  const matches = (node.pageSections ?? []).filter(
    (placement) => placement.page === page,
  );
  matches.sort(
    (a, b) => a.position - b.position || a.section.localeCompare(b.section),
  );
  const first = matches[0];
  return first ? { section: first.section, position: first.position } : null;
}

function closerPage(candidate: PageHome, current: PageHome): boolean {
  const byPage = candidate.page.localeCompare(current.page);
  if (byPage !== 0) return byPage < 0;
  if (candidate.position !== current.position)
    return candidate.position < current.position;
  return (candidate.section ?? "").localeCompare(current.section ?? "") < 0;
}

// Each domain hub joins the article, then the section, that cites the most of its notes.
// A topic with no article of its own joins the topic it connects to most.
function domainsInsidePageGroups(
  nodes: readonly GraphNode[],
  evidenceNodes: readonly GraphNode[],
  evidenceLinks: readonly GraphLink[],
): GraphNode[] {
  const pages = new Map<string, Map<string, number>>();
  const sections = new Map<
    string,
    Map<string, Map<string, { count: number; position: number }>>
  >();
  for (const node of evidenceNodes) {
    if (node.kind === "domain" || node.kind === "entity") continue;
    const titles = node.pageTitles ?? [];
    if (titles.length === 0) continue;
    for (const path of node.domainPaths) {
      const pageCounts = pages.get(path) ?? new Map<string, number>();
      for (const title of titles) {
        pageCounts.set(title, (pageCounts.get(title) ?? 0) + 1);
        const section = homeSection(node, title);
        if (!section) continue;
        const byPage = sections.get(path) ?? new Map();
        const bySection = byPage.get(title) ?? new Map();
        const previous = bySection.get(section.section);
        bySection.set(section.section, {
          count: (previous?.count ?? 0) + 1,
          position: section.position,
        });
        byPage.set(title, bySection);
        sections.set(path, byPage);
      }
      pages.set(path, pageCounts);
    }
  }
  const assigned = new Map<string, PageHome>();
  for (const [path, counts] of pages) {
    const page = preferredName(counts);
    if (!page) continue;
    let section: string | null = null;
    let position = Number.POSITIVE_INFINITY;
    let bestCount = -1;
    for (const [name, tally] of sections.get(path)?.get(page) ?? []) {
      if (
        tally.count > bestCount ||
        (tally.count === bestCount && tally.position < position) ||
        (tally.count === bestCount &&
          tally.position === position &&
          (section === null || name.localeCompare(section) < 0))
      ) {
        section = name;
        position = tally.position;
        bestCount = tally.count;
      }
    }
    assigned.set(path, {
      page,
      section,
      position: section ? position : 0,
    });
  }
  const domainPaths = topicPaths(nodes);
  spreadTopicGroups(
    domainPaths,
    topicNeighbors(domainPaths, evidenceNodes, evidenceLinks),
    assigned,
    closerPage,
  );
  return nodes.map((node) => {
    if (node.kind !== "domain") return node;
    const home = assigned.get(node.domainPaths[0] ?? "");
    if (!home) return node;
    return {
      ...node,
      pageTitles: [home.page],
      pageSections: home.section
        ? [{ page: home.page, section: home.section, position: home.position }]
        : [],
    };
  });
}

// Domain paths that still have a visible non-domain dot (and every ancestor path).
function domainPathsWithContent(nodes: readonly GraphNode[]): Set<string> {
  const paths = new Set<string>();
  for (const node of nodes) {
    if (node.kind === "domain") continue;
    const path = [...node.domainPaths].sort()[0] ?? "";
    if (!path) continue;
    const segments = path.split("/").filter(Boolean);
    for (let depth = 1; depth <= segments.length; depth++)
      paths.add(segments.slice(0, depth).join("/"));
  }
  return paths;
}

// GROUP LAYERS: when circles stand in for hubs, drop that layer's dots and spokes so units sit inside.
export function graphForGrouping(
  data: GraphData,
  groupBy: "domain" | "entity" | "page" | "off",
  // Claims and links from before the layer toggles, so hidden units still place domain hubs.
  evidence: GraphData = data,
): GraphData {
  if (groupBy === "entity") {
    const nodes = domainsInsideEntityGroups(
      data.nodes,
      evidence.nodes,
      evidence.links,
    ).filter((node) => node.kind !== "entity");
    const ids = new Set(nodes.map((node) => node.id));
    return {
      nodes,
      links: data.links.filter(
        (link) =>
          link.kind !== "about" && ids.has(link.source) && ids.has(link.target),
      ),
    };
  }
  if (groupBy === "page") {
    const nodes = domainsInsidePageGroups(
      data.nodes,
      evidence.nodes,
      evidence.links,
    ).filter((node) => node.kind !== "page");
    const ids = new Set(nodes.map((node) => node.id));
    return {
      nodes,
      links: data.links.filter(
        (link) =>
          link.kind !== "cites" && ids.has(link.source) && ids.has(link.target),
      ),
    };
  }
  if (groupBy === "domain") {
    const pathsWithContent = domainPathsWithContent(data.nodes);
    const nodes = data.nodes.filter((node) => {
      if (node.kind !== "domain") return true;
      const path = [...node.domainPaths].sort()[0] ?? "";
      if (!path) return false;
      // Notes define which topic circles exist. With no notes, the domain nodes are the circles.
      if (pathsWithContent.size === 0) return true;
      return pathsWithContent.has(path);
    });
    const ids = new Set(nodes.map((node) => node.id));
    return {
      nodes,
      links: data.links.filter(
        (link) => ids.has(link.source) && ids.has(link.target),
      ),
    };
  }
  return data;
}

// APPLY: the visible graph for these filters
export function applyFilters(
  data: GraphData,
  filters: GraphFilters,
): GraphData {
  const shownKinds = new Set<GraphNodeKind>();
  if (filters.showUnits) shownKinds.add("unit");
  if (filters.showEntities) shownKinds.add("entity");
  if (filters.showDomains) shownKinds.add("domain");
  if (filters.showPages) shownKinds.add("page");
  const search = filters.search.trim().toLowerCase();

  const byLayer = keepNodes(
    inDomain(inDomainScope(data, filters.domainScope), filters.domain),
    (node) => shownKinds.has(node.kind),
  );
  const bySearch = search
    ? keepNodes(
        byLayer,
        (node) =>
          node.label.toLowerCase().includes(search) ||
          node.text.toLowerCase().includes(search),
      )
    : byLayer;
  const visible = filters.showOrphans
    ? bySearch
    : keepNodes(
        bySearch,
        (node) =>
          linkedIds(bySearch).has(node.id) ||
          (node.kind === "domain" && node.degree > 0),
      );
  return applyRelationships(
    applyConnectors(visible, filters.showConnectors),
    filters.showRelationships,
  );
}

// REPLAY CUT: only what existed at `cutoff` (ms since epoch)
export function createdBy(data: GraphData, cutoff: number): GraphData {
  return keepNodes(data, (node) => Date.parse(node.createdAt) <= cutoff);
}
