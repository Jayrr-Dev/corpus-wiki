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
  showDomains: boolean;
  showPages: boolean;
  showOrphans: boolean;
  // Lines that attach a note to a domain, entity, or page
  showConnectors: boolean;
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

// Each domain hub joins the entity that shares the most claims in that topic, as a dot inside that circle.
function domainsInsideEntityGroups(nodes: readonly GraphNode[]): GraphNode[] {
  const shared = new Map<string, Map<string, number>>();
  for (const node of nodes) {
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
  const bestPath = new Map<string, string>();
  const names = new Set(
    [...shared.values()].flatMap((counts) => [...counts.keys()]),
  );
  for (const name of names) {
    const paths = [...shared.entries()].filter(([, counts]) =>
      counts.has(name),
    );
    paths.sort((a, b) => {
      const byClaims = (b[1].get(name) ?? 0) - (a[1].get(name) ?? 0);
      if (byClaims !== 0) return byClaims;
      return a[0].localeCompare(b[0]);
    });
    const winner = paths[0];
    if (winner) bestPath.set(name, winner[0]);
  }
  const host = new Map<string, string>();
  for (const [name, path] of bestPath) {
    const current = host.get(path);
    const counts = shared.get(path);
    const nextCount = counts?.get(name) ?? 0;
    const currentCount = current ? (counts?.get(current) ?? 0) : -1;
    if (
      !current ||
      nextCount > currentCount ||
      (nextCount === currentCount && name.localeCompare(current) < 0)
    )
      host.set(path, name);
  }
  return nodes.map((node) => {
    if (node.kind !== "domain") return node;
    const name = host.get(node.domainPaths[0] ?? "");
    return name ? { ...node, entityNames: [name] } : node;
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
): GraphData {
  if (groupBy === "entity") {
    const nodes = domainsInsideEntityGroups(data.nodes).filter(
      (node) => node.kind !== "entity",
    );
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
    const nodes = data.nodes.filter((node) => node.kind !== "page");
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
  return applyConnectors(visible, filters.showConnectors);
}

// REPLAY CUT: only what existed at `cutoff` (ms since epoch)
export function createdBy(data: GraphData, cutoff: number): GraphData {
  return keepNodes(data, (node) => Date.parse(node.createdAt) <= cutoff);
}
