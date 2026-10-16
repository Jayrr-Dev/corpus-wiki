import type { GraphData, GraphNode, GraphNodeKind } from "./types";

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
  showPages: boolean;
  showOrphans: boolean;
  // derived "similar" links between related units, and the minimum score (0..1) they need
  showRelated: boolean;
  relatedness: number;
}

// Keeps the links whose two ends are both in `ids`
function linksWithin(data: GraphData, ids: ReadonlySet<string>): GraphData["links"] {
  return data.links.filter((link) => ids.has(link.source) && ids.has(link.target));
}

// Keeps the nodes that pass `keep`, and the links between them
export function keepNodes(data: GraphData, keep: (node: GraphData["nodes"][number]) => boolean): GraphData {
  const nodes = data.nodes.filter(keep);
  const ids = new Set(nodes.map((node) => node.id));
  return { nodes, links: linksWithin(data, ids) };
}

// Ids of the nodes that touch at least one link
function linkedIds(data: GraphData): Set<string> {
  return new Set(data.links.flatMap((link) => [link.source, link.target]));
}

// DOMAIN FOCUS: units and pages in `domain` or a subdomain below it. Entities have no
// domain, so one stays when it links to something kept.
export function inDomain(data: GraphData, domain: string): GraphData {
  const focus = domain.trim().replace(/\/+$/, "").toLowerCase();
  if (!focus) return data;
  const matches = (path: string) => {
    const lower = path.toLowerCase();
    return lower === focus || lower.startsWith(`${focus}/`);
  };
  const matched = new Set(data.nodes.filter((node) => node.domainPaths.some(matches)).map((node) => node.id));
  const linked = new Set(data.links.flatMap((link) => (matched.has(link.source) ? [link.target] : matched.has(link.target) ? [link.source] : [])));
  return keepNodes(data, (node) => matched.has(node.id) || (node.kind === "entity" && linked.has(node.id)));
}

export function domainPathsForScope(node: GraphNode, scope: GraphFilters["domainScope"]): string[] {
  const internal = node.domainScopePaths?.internal ?? node.domainPaths;
  const external = node.domainScopePaths?.external ?? [];
  if (scope === "none") return [];
  if (scope === "both") return [...new Set([...internal, ...external])];
  return scope === "internal" ? internal : external;
}

// Entities follow connected notes; unassigned notes remain in Internal.
export function inDomainScope(data: GraphData, scope: GraphFilters["domainScope"]): GraphData {
  const matched = new Set(data.nodes.filter((node) => node.kind !== "entity" &&
    (domainPathsForScope(node, scope).length > 0 ||
      ((scope === "internal" || scope === "both") && node.domainPaths.length === 0))).map((node) => node.id));
  const linked = new Set(data.links.flatMap((link) => matched.has(link.source) ? [link.target] : matched.has(link.target) ? [link.source] : []));
  const scoped = keepNodes(data, (node) => matched.has(node.id) || (node.kind === "entity" && linked.has(node.id)));
  return { ...scoped, nodes: scoped.nodes.map((node) => ({ ...node, domainPaths: domainPathsForScope(node, scope) })) };
}

// APPLY: the visible graph for these filters
export function applyFilters(data: GraphData, filters: GraphFilters): GraphData {
  const shownKinds = new Set<GraphNodeKind>();
  if (filters.showUnits) shownKinds.add("unit");
  if (filters.showEntities) shownKinds.add("entity");
  if (filters.showPages) shownKinds.add("page");
  const search = filters.search.trim().toLowerCase();

  const byLayer = keepNodes(inDomain(inDomainScope(data, filters.domainScope), filters.domain), (node) => shownKinds.has(node.kind));
  const bySearch = search ? keepNodes(byLayer, (node) => node.label.toLowerCase().includes(search)) : byLayer;
  if (filters.showOrphans) return bySearch;
  const linked = linkedIds(bySearch);
  return keepNodes(bySearch, (node) => linked.has(node.id));
}

// REPLAY CUT: only what existed at `cutoff` (ms since epoch)
export function createdBy(data: GraphData, cutoff: number): GraphData {
  return keepNodes(data, (node) => Date.parse(node.createdAt) <= cutoff);
}
