import {
  circleNestedIn,
  circleSubgroups,
  clusterKey,
  NO_ARTICLE_LABEL,
  type ClusterMode,
} from "./clusters";
import { GROUPINGS } from "./groupings";
import { centersGrouping, hasHubBody } from "./nodeTypes";
import type { SimLink, SimNode } from "./physics";
import type { GraphData, GraphLink, GraphNode } from "./types";

// =====================================================================
// COALESCENCE: claims that sit in the same circle become one dot.
// A lone claim stays itself. Lines inside the circle disappear.
// Lines that leave the circle stay, one per other dot.
// The group you zoom into splits back into its claims, and so does
// every group inside it. No article is the exception: its connection
// circles stay combined until you zoom into that circle.
// =====================================================================

// The name at the end of a circle key. Flat names (entities) are one piece, even with a slash.
function leafName(key: string, mode: ClusterMode): string {
  const { nests, separator } = GROUPINGS[mode];
  if (!nests) return key;
  const parts = key.split(separator).filter(Boolean);
  return parts[parts.length - 1] ?? key;
}

function latestActivity(members: readonly GraphNode[]): string | undefined {
  let latest: string | undefined;
  for (const member of members) {
    if (!member.activityAt) continue;
    if (!latest || member.activityAt > latest) latest = member.activityAt;
  }
  return latest;
}

// A pile grows with the square root of its count, then stops.
// Twice that root reads as a pile. The raw count made Orphans a moon.
const PILE_DEGREE_CAP = 24;

function pileDegree(members: readonly GraphNode[]): number {
  const busiest = Math.max(...members.map((member) => member.degree));
  const piled = Math.min(
    PILE_DEGREE_CAP,
    1 + Math.round(Math.sqrt(members.length) * 2),
  );
  return Math.max(busiest, piled);
}

// One dot for a pile of claims. It stays at least as big as its biggest claim.
function combine(
  key: string,
  members: readonly GraphNode[],
  mode: ClusterMode,
): GraphNode {
  const first = members[0]!;
  const count = members.length;
  const leaf = leafName(key, mode);
  const named = members.find((member) => member.id === leaf);
  return {
    ...first,
    id: `coalesce:${key}`,
    label: `${named?.label ?? leaf} (${count})`,
    text: members.map((member) => member.label).join("\n"),
    href: "",
    degree: pileDegree(members),
    createdAt: members.map((member) => member.createdAt).sort()[0]!,
    activityAt: latestActivity(members),
    memberIds: members.map((member) => member.id),
    unitKind: null,
    status: null,
  };
}

// Stored lines win over a dashed "similar" guess between the same pair.
function linkRank(link: GraphLink): number {
  return link.kind === "similar" ? 1 : 0;
}

function pairKey(source: string, target: string): string {
  return source < target ? `${source}|${target}` : `${target}|${source}`;
}

// The opened group, and groups nested inside it, stay as separate claims.
function staysOpen(key: string, openKey: string, mode: ClusterMode): boolean {
  if (key === openKey) return true;
  // No article is a holder for connection circles. Zooming into it keeps
  // Orphans, Linked, and each hub circle combined.
  if (mode === "page" && openKey === NO_ARTICLE_LABEL) return false;
  return circleNestedIn(key, openKey, mode);
}

export function coalesceGraph(
  data: GraphData,
  mode: ClusterMode,
  openKey: string | null = null,
): GraphData {
  const hubs = circleSubgroups(data.nodes, data.links, mode);
  const buckets = new Map<string, GraphNode[]>();
  for (const node of data.nodes) {
    if (hasHubBody(node) || centersGrouping(node, mode)) continue;
    const key = clusterKey(node, mode, hubs);
    if (!key) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(node);
    else buckets.set(key, [node]);
  }

  const replacement = new Map<string, string>();
  const combined: GraphNode[] = [];
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    if (openKey !== null && staysOpen(key, openKey, mode)) continue;
    const node = combine(key, members, mode);
    combined.push(node);
    for (const member of members) replacement.set(member.id, node.id);
  }
  if (replacement.size === 0) return data;

  const nodes = [
    ...data.nodes.filter((node) => !replacement.has(node.id)),
    ...combined,
  ];
  const links = new Map<string, GraphLink>();
  for (const link of data.links) {
    const source = replacement.get(link.source) ?? link.source;
    const target = replacement.get(link.target) ?? link.target;
    if (source === target) continue;
    const kept = { ...link, source, target };
    const key = pairKey(source, target);
    const previous = links.get(key);
    if (!previous || linkRank(kept) < linkRank(previous)) links.set(key, kept);
  }
  return { nodes, links: [...links.values()] };
}

function endId(end: SimLink["source"]): string {
  return typeof end === "object" ? end.id : String(end);
}

function centroid(members: readonly SimNode[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const member of members) {
    if (member.x == null || member.y == null) continue;
    x += member.x;
    y += member.y;
    count += 1;
  }
  if (count === 0) return { x: 0, y: 0 };
  return { x: x / count, y: y / count };
}

// Draw view of a settled layout. Combined dots sit on the claims they stand
// for, and the claims themselves stay put. Zooming does not rebuild the map.
export function coalesceDrawn(
  nodes: readonly SimNode[],
  links: readonly SimLink[],
  mode: ClusterMode,
  openKey: string | null,
): { nodes: SimNode[]; links: SimLink[] } {
  const plain = links.map((link) => ({
    id: link.id,
    kind: link.kind,
    source: endId(link.source),
    target: endId(link.target),
  }));
  const graph = coalesceGraph({ nodes: [...nodes], links: plain }, mode, openKey);
  if (graph.nodes.length === nodes.length) return { nodes: [...nodes], links: [...links] };
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const drawn = graph.nodes.map((node) => {
    const live = byId.get(node.id);
    if (live) return live;
    const members = (node.memberIds ?? [])
      .map((id) => byId.get(id))
      .filter((member) => member !== undefined);
    return { ...node, ...centroid(members) };
  });
  const drawnById = new Map(drawn.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const drawnLinks: SimLink[] = [];
  for (const link of graph.links) {
    const source = drawnById.get(link.source);
    const target = drawnById.get(link.target);
    if (!source || !target) continue;
    const key = pairKey(source.id, target.id);
    if (seen.has(key)) continue;
    seen.add(key);
    drawnLinks.push({ ...link, source, target });
  }
  return { nodes: drawn, links: drawnLinks };
}
