import type { GraphData, GraphNodeKind } from "./types";

// =====================================================================
// FILTERS (Obsidian's Filters section): which nodes show. Order:
// layer toggles, then search, then orphans, so a node left without
// visible links by the first two counts as an orphan.
// =====================================================================

export interface GraphFilters {
  search: string;
  showEntities: boolean;
  showPages: boolean;
  showOrphans: boolean;
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

// APPLY: the visible graph for these filters
export function applyFilters(data: GraphData, filters: GraphFilters): GraphData {
  const shownKinds = new Set<GraphNodeKind>(["unit"]);
  if (filters.showEntities) shownKinds.add("entity");
  if (filters.showPages) shownKinds.add("page");
  const search = filters.search.trim().toLowerCase();

  const byLayer = keepNodes(data, (node) => shownKinds.has(node.kind));
  const bySearch = search ? keepNodes(byLayer, (node) => node.label.toLowerCase().includes(search)) : byLayer;
  if (filters.showOrphans) return bySearch;
  const linked = linkedIds(bySearch);
  return keepNodes(bySearch, (node) => linked.has(node.id));
}

// REPLAY CUT: only what existed at `cutoff` (ms since epoch)
export function createdBy(data: GraphData, cutoff: number): GraphData {
  return keepNodes(data, (node) => Date.parse(node.createdAt) <= cutoff);
}
