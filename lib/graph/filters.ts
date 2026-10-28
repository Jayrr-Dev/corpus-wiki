import { type GroupingId, GROUPINGS } from "./groupings";
import { centersGrouping, isHub, isPlacedByLinks } from "./nodeTypes";
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
  // Which node types show, one switch per type in the Nodes section
  shown: Record<GraphNodeKind, boolean>;
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
      matched.has(node.id) || (isPlacedByLinks(node) && linked.has(node.id)),
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
          !isPlacedByLinks(node) &&
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
      matched.has(node.id) || (isPlacedByLinks(node) && linked.has(node.id)),
  );
  return {
    ...scoped,
    nodes: scoped.nodes.map((node) => ({
      ...node,
      // A domain node is the topic itself. Scope filters notes, not the topic path.
      domainPaths: centersGrouping(node, "domain")
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
    if (isPlacedByLinks(node)) continue;
    for (const path of node.domainPaths) paths.add(path);
  }
  if (paths.size === 0) return filtered;
  const domainByPath = new Map(
    source.nodes
      .filter((node) => centersGrouping(node, "domain") && node.domainPaths[0])
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

// How a hub is known in its claims: a page by its title (the units it cites), a domain by
// its path, an entity by its name. The first field with a home wins. Paths nest, so a topic
// also neighbors its parent.
const IDENTITIES = [
  { field: "pageTitles", nests: false },
  { field: "domainPaths", nests: true },
  { field: "entityNames", nests: false },
] as const;

type IdentityField = (typeof IDENTITIES)[number]["field"];

// Parent keys, child keys, and links between their claims. About, in, cites,
// and similar lines are not bridges: the group counts already used those.
function keyNeighbors(
  keys: readonly string[],
  field: IdentityField,
  nests: boolean,
  claims: readonly GraphNode[],
  evidenceLinks: readonly GraphLink[],
): Map<string, Map<string, number>> {
  const keysOf = new Map<string, readonly string[]>();
  for (const claim of claims) keysOf.set(claim.id, claim[field] ?? []);
  const neighbors = new Map<string, Map<string, number>>();
  const connect = (left: string, right: string) => {
    if (!left || !right || left === right) return;
    const row = neighbors.get(left) ?? new Map<string, number>();
    row.set(right, (row.get(right) ?? 0) + 1);
    neighbors.set(left, row);
  };
  if (nests) {
    for (const key of keys) {
      const parent = key.split("/").slice(0, -1).join("/");
      if (!parent) continue;
      connect(key, parent);
      connect(parent, key);
    }
  }
  for (const link of evidenceLinks) {
    if (
      link.kind === "about" ||
      link.kind === "in" ||
      link.kind === "cites" ||
      link.kind === "similar"
    )
      continue;
    const left = keysOf.get(link.source);
    const right = keysOf.get(link.target);
    if (!left || !right) continue;
    for (const sourceKey of left) {
      for (const targetKey of right) {
        connect(sourceKey, targetKey);
        connect(targetKey, sourceKey);
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

// Where one grouping puts a hub that is not its own hub
interface HomeRule<T> {
  // What one claim says about where its hubs belong. A hub with votes of its own is already in a circle.
  votes: (claim: GraphNode) => readonly string[];
  // The home for the winning vote, from the claims behind it
  home: (winner: string, claims: readonly GraphNode[]) => T;
  closer: (candidate: T, current: T) => boolean;
  place: (node: GraphNode, home: T) => GraphNode;
}

const byName = (candidate: string, current: string) =>
  candidate.localeCompare(current) < 0;

// Each hub that is not this grouping's own hub, and has nothing of its own that puts it in a
// circle, joins the home most of its claims vote for: a domain or an entity always, a page only
// when it has no domain or entity of its own. A key with no votes joins the one it connects to most.
function placeLinkedHubs<T>(
  nodes: readonly GraphNode[],
  evidenceNodes: readonly GraphNode[],
  evidenceLinks: readonly GraphLink[],
  mode: GroupingId,
  rule: HomeRule<T>,
): GraphNode[] {
  const placed = (node: GraphNode) =>
    isHub(node) &&
    !centersGrouping(node, mode) &&
    rule.votes(node).length === 0;
  const claims = evidenceNodes.filter((node) => !isPlacedByLinks(node));
  const homes = new Map<string, T>();
  for (const { field, nests } of IDENTITIES) {
    const keyOf = (node: GraphNode) => node[field]?.[0] ?? "";
    const keys = [
      ...new Set(nodes.filter(placed).map(keyOf).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b));
    if (keys.length === 0) continue;
    const claimsByKey = new Map<string, GraphNode[]>();
    for (const claim of claims) {
      for (const key of claim[field] ?? []) {
        const keyed = claimsByKey.get(key) ?? [];
        keyed.push(claim);
        claimsByKey.set(key, keyed);
      }
    }
    const assigned = new Map<string, T>();
    for (const [key, keyed] of claimsByKey) {
      const counts = new Map<string, number>();
      for (const claim of keyed)
        for (const vote of rule.votes(claim))
          counts.set(vote, (counts.get(vote) ?? 0) + 1);
      const winner = preferredName(counts);
      if (winner) assigned.set(key, rule.home(winner, keyed));
    }
    spreadTopicGroups(
      keys,
      keyNeighbors(keys, field, nests, claims, evidenceLinks),
      assigned,
      rule.closer,
    );
    for (const node of nodes) {
      if (!placed(node) || homes.has(node.id)) continue;
      const home = assigned.get(keyOf(node));
      if (home !== undefined) homes.set(node.id, home);
    }
  }
  return nodes.map((node) => {
    const home = homes.get(node.id);
    return home === undefined ? node : rule.place(node, home);
  });
}

// Domain grouping: the domain most of its claims sit in
const DOMAIN_HOME: HomeRule<string> = {
  votes: (claim) => claim.domainPaths,
  home: (path) => path,
  closer: byName,
  place: (node, path) => ({ ...node, domainPaths: [path] }),
};

// Entities grouping: the entity that shares the most of its claims
const ENTITY_HOME: HomeRule<string> = {
  votes: (claim) => claim.entityNames,
  home: (name) => name,
  closer: byName,
  place: (node, name) => ({ ...node, entityNames: [name] }),
};

// Stakeholders grouping: the stakeholder that shares the most of its claims
const STAKEHOLDER_HOME: HomeRule<string> = {
  votes: (claim) => claim.stakeholderNames ?? [],
  home: (name) => name,
  closer: byName,
  place: (node, name) => ({ ...node, stakeholderNames: [name] }),
};

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

// Pages grouping: the article, then the section, that cites the most of its claims
const PAGE_HOME: HomeRule<PageHome> = {
  votes: (claim) => claim.pageTitles ?? [],
  home: (page, claims) => {
    const sections = new Map<string, { count: number; position: number }>();
    for (const claim of claims) {
      if (!(claim.pageTitles ?? []).includes(page)) continue;
      const section = homeSection(claim, page);
      if (!section) continue;
      const previous = sections.get(section.section);
      sections.set(section.section, {
        count: (previous?.count ?? 0) + 1,
        position: section.position,
      });
    }
    let section: string | null = null;
    let position = Number.POSITIVE_INFINITY;
    let bestCount = -1;
    for (const [name, tally] of sections) {
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
    return { page, section, position: section ? position : 0 };
  },
  closer: closerPage,
  place: (node, home) => ({
    ...node,
    pageTitles: [home.page],
    pageSections: home.section
      ? [{ page: home.page, section: home.section, position: home.position }]
      : [],
  }),
};

// Domain paths that still have a visible non-domain dot (and every ancestor path).
function domainPathsWithContent(nodes: readonly GraphNode[]): Set<string> {
  const paths = new Set<string>();
  for (const node of nodes) {
    if (centersGrouping(node, "domain")) continue;
    const path = [...node.domainPaths].sort()[0] ?? "";
    if (!path) continue;
    const segments = path.split("/").filter(Boolean);
    for (let depth = 1; depth <= segments.length; depth++)
      paths.add(segments.slice(0, depth).join("/"));
  }
  return paths;
}

// Where each grouping puts the hubs it does not center. Keyed by grouping, so a new one needs a rule.
const HOME_RULES = {
  domain: DOMAIN_HOME,
  entity: ENTITY_HOME,
  stakeholder: STAKEHOLDER_HOME,
  page: PAGE_HOME,
} satisfies Record<GroupingId, unknown>;

// GROUP LAYERS: each grouping keeps its own hub dots, pinned in the middle of their circles,
// and places the other link-placed hubs (domains, entities) inside the circles.
export function graphForGrouping(
  data: GraphData,
  groupBy: GroupingId | "off",
  // Claims and links from before the layer toggles, so hidden units still place hubs.
  evidence: GraphData = data,
): GraphData {
  if (groupBy === "off") return data;
  const rule = HOME_RULES[groupBy] as HomeRule<unknown>;
  const placed = placeLinkedHubs(
    data.nodes,
    evidence.nodes,
    evidence.links,
    groupBy,
    rule,
  );
  if (groupBy === "domain") {
    const pathsWithContent = domainPathsWithContent(placed);
    const nodes = placed.filter((node) => {
      if (node.kind !== GROUPINGS.domain.hubKind) return true;
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
  return { nodes: placed, links: data.links };
}

// APPLY: the visible graph for these filters
export function applyFilters(
  data: GraphData,
  filters: GraphFilters,
): GraphData {
  const search = filters.search.trim().toLowerCase();

  const byLayer = keepNodes(
    inDomain(inDomainScope(data, filters.domainScope), filters.domain),
    (node) => filters.shown[node.kind],
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
          (centersGrouping(node, "domain") && node.degree > 0),
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
