import { circleNestedIn, clusterKey, type ClusterMode } from "./clusters";
import { centersAnyGrouping } from "./nodeTypes";
import type { GraphData, GraphLink, GraphNode } from "./types";

// =====================================================================
// COALESCENCE: claims that sit in the same circle become one dot.
// A lone claim stays itself. Lines inside the circle disappear.
// Lines that leave the circle stay, one per other dot.
// The group you zoom into splits back into its claims, and so does
// every group inside it. The rest stay combined.
// =====================================================================

// The name at the end of a circle key. Entity names are one piece, even with a slash.
function leafName(key: string, mode: ClusterMode): string {
  if (mode === "entity") return key;
  const parts = key.split(mode === "page" ? "\u001f" : "/").filter(Boolean);
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

// One dot for a pile of claims. Size follows the pile, and never shrinks
// below the biggest claim in it.
function combine(
  key: string,
  members: readonly GraphNode[],
  mode: ClusterMode,
): GraphNode {
  const first = members[0]!;
  const count = members.length;
  return {
    ...first,
    id: `coalesce:${key}`,
    label: `${leafName(key, mode)} (${count})`,
    text: members.map((member) => member.label).join("\n"),
    href: "",
    degree: Math.max(count, ...members.map((member) => member.degree)),
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
  return key === openKey || circleNestedIn(key, openKey, mode);
}

export function coalesceGraph(
  data: GraphData,
  mode: ClusterMode,
  openKey: string | null = null,
): GraphData {
  const buckets = new Map<string, GraphNode[]>();
  for (const node of data.nodes) {
    if (centersAnyGrouping(node)) continue;
    const key = clusterKey(node, mode);
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
