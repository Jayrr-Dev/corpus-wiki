import type { Force } from "d3-force";
import { nodeRadius, type SimNode } from "./physics";
import type { GraphNode } from "./types";

// =====================================================================
// DOMAIN CLUSTERS: groups dots by the domain they sit in. A node's
// primary domain is its first domain path. Levels every visible dot
// shares ("Company/Health & Safety") are skipped as the trunk, so the
// circles start where the tree branches: the next segment is the
// domain ("PPE") and the one after it the subdomain ("PPE/Gloves").
// A force pulls each domain toward its own spot on a ring and each
// subdomain toward its own middle, and circles are drawn around both.
// =====================================================================

export type ClusterLevel = "domain" | "subdomain";

export interface ClusterKeys {
  domain: string;
  subdomain: string | null;
}

// CIRCLE: one drawn ring in world units; `index` picks its color (subdomains share their domain's)
export interface ClusterCircle {
  key: string;
  label: string;
  level: ClusterLevel;
  x: number;
  y: number;
  r: number;
  index: number;
}

// SPACING in world units: room between dots and their ring, and between a subdomain ring and its domain ring
const SUBDOMAIN_PAD = 10;
const DOMAIN_PAD = 18;
// RING OF DOMAIN SPOTS: radius grows with the number of dots so bigger graphs spread wider
const RING_PER_DOT = 14;
const RING_MIN = 120;

// Segments of a node's primary domain path (empty when it has none)
function primarySegments(node: Pick<GraphNode, "domainPaths">): string[] {
  return ([...node.domainPaths].sort()[0] ?? "").split("/").filter(Boolean);
}

// TRUNK: how many leading segments every path shares, keeping at least one segment per path below it
export function trunkDepth(paths: readonly (readonly string[])[]): number {
  const [first, ...rest] = paths.filter((segments) => segments.length > 0);
  if (!first) return 0;
  const limit = Math.min(first.length, ...rest.map((segments) => segments.length)) - 1;
  let depth = 0;
  while (depth < limit && rest.every((segments) => segments[depth] === first[depth])) depth += 1;
  return depth;
}

// Domain and subdomain for a node below a trunk of `depth` segments, or null when it has no domain
export function clusterKeys(node: Pick<GraphNode, "domainPaths">, depth = 0): ClusterKeys | null {
  const segments = primarySegments(node).slice(depth);
  const [top, sub] = segments;
  if (!top) return null;
  return { domain: top, subdomain: sub ? `${top}/${sub}` : null };
}

// Keys for every node, with the trunk worked out from the nodes themselves
export function keysFor(nodes: readonly SimNode[]): Map<SimNode, ClusterKeys> {
  const depth = trunkDepth(nodes.map(primarySegments));
  const keys = new Map<SimNode, ClusterKeys>();
  for (const node of nodes) {
    const found = clusterKeys(node, depth);
    if (found) keys.set(node, found);
  }
  return keys;
}

// Group a node is pulled into: its subdomain when it has one, else its domain
export function clusterOf(keys: ClusterKeys | undefined): string | undefined {
  return keys ? (keys.subdomain ?? keys.domain) : undefined;
}

// Last segment of a path, for the ring's label
function lastSegment(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

// Members of each key, plus the sorted domain names (sorted so colors and ring spots stay stable)
function membersBy(nodes: readonly SimNode[]): { domains: Map<string, SimNode[]>; subdomains: Map<string, SimNode[]>; order: string[] } {
  const domains = new Map<string, SimNode[]>();
  const subdomains = new Map<string, SimNode[]>();
  for (const [node, keys] of keysFor(nodes)) {
    domains.set(keys.domain, [...(domains.get(keys.domain) ?? []), node]);
    if (keys.subdomain) subdomains.set(keys.subdomain, [...(subdomains.get(keys.subdomain) ?? []), node]);
  }
  return { domains, subdomains, order: [...domains.keys()].sort() };
}

// Middle of a set of dots
function centroid(nodes: readonly SimNode[]): { x: number; y: number } {
  const x = nodes.reduce((sum, node) => sum + (node.x ?? 0), 0) / nodes.length;
  const y = nodes.reduce((sum, node) => sum + (node.y ?? 0), 0) / nodes.length;
  return { x, y };
}

// Rough ring size for a group of `count` dots, used to space spots before the layout settles
const groupSize = (count: number) => RING_PER_DOT * Math.sqrt(count) + DOMAIN_PAD;

// SPOTS: groups evenly round a ring about `center`, the ring long enough that neighbors do not overlap.
// One group sits on the center itself; `inner` keeps the ring clear of dots held at the center.
function spotsAround(center: { x: number; y: number }, counts: readonly (readonly [string, number])[], inner: number): Map<string, { x: number; y: number }> {
  if (counts.length === 1 && inner === 0) return new Map([[counts[0]![0], center]]);
  const sizes = counts.map(([, count]) => groupSize(count));
  const ring = Math.max(RING_MIN / 2, inner + Math.max(0, ...sizes), sizes.reduce((sum, size) => sum + size * 2, 0) / (Math.PI * 2));
  return new Map(counts.map(([key], i) => {
    const angle = (i / counts.length) * Math.PI * 2 - Math.PI / 2;
    return [key, { x: center.x + Math.cos(angle) * ring, y: center.y + Math.sin(angle) * ring }];
  }));
}

// FORCE: each dot toward its subdomain's spot (inside its domain), else its domain's spot. Strength 0 turns it off.
export function forceClusters(strength: number): Force<SimNode, undefined> {
  let targets = new Map<SimNode, { x: number; y: number }>();

  const force = (alpha: number) => {
    if (strength <= 0) return;
    const pull = strength * alpha * 0.6;
    for (const [node, spot] of targets) {
      node.vx = (node.vx ?? 0) + (spot.x - (node.x ?? 0)) * pull;
      node.vy = (node.vy ?? 0) + (spot.y - (node.y ?? 0)) * pull;
    }
  };

  force.initialize = (nodes: SimNode[]) => {
    const { domains, subdomains, order } = membersBy(nodes);
    // Domains round the origin, sized by everything inside them
    const domainSpots = spotsAround({ x: 0, y: 0 }, order.map((domain) => [domain, domains.get(domain)?.length ?? 0] as const), 0);
    // Subdomains round their domain's spot, clear of the domain's own dots at the center
    const subSpots = new Map<string, { x: number; y: number }>();
    for (const domain of order) {
      const children = [...subdomains.entries()].filter(([key]) => key.startsWith(`${domain}/`)).sort(([a], [b]) => a.localeCompare(b));
      if (children.length === 0) continue;
      const atCenter = (domains.get(domain)?.length ?? 0) - children.reduce((sum, [, inside]) => sum + inside.length, 0);
      const counts = children.map(([key, inside]) => [key, inside.length] as const);
      const spots = spotsAround(domainSpots.get(domain) ?? { x: 0, y: 0 }, counts, atCenter > 0 ? groupSize(atCenter) : 0);
      for (const [key, spot] of spots) subSpots.set(key, spot);
    }
    targets = new Map();
    for (const [node, keys] of keysFor(nodes)) {
      const spot = (keys.subdomain ? subSpots.get(keys.subdomain) : undefined) ?? domainSpots.get(keys.domain);
      if (spot) targets.set(node, spot);
    }
  };
  return force;
}

// Smallest ring around the middle that holds every dot (and child ring), plus padding
function ringAround(middle: { x: number; y: number }, nodes: readonly SimNode[], children: readonly ClusterCircle[], nodeSize: number, pad: number): number {
  const fromDots = nodes.map((node) => Math.hypot((node.x ?? 0) - middle.x, (node.y ?? 0) - middle.y) + nodeRadius(node, nodeSize));
  const fromChildren = children.map((child) => Math.hypot(child.x - middle.x, child.y - middle.y) + child.r);
  return Math.max(0, ...fromDots, ...fromChildren) + pad;
}

// CIRCLES for the current positions: subdomain rings first, then the domain rings that hold them.
// A subdomain ring is skipped when it would be the only one in its domain (the domain ring says it all).
export function clusterCircles(nodes: readonly SimNode[], nodeSize: number): ClusterCircle[] {
  const { domains, subdomains, order } = membersBy(nodes);
  const circles: ClusterCircle[] = [];
  order.forEach((domain, index) => {
    const members = domains.get(domain) ?? [];
    const childKeys = [...subdomains.keys()].filter((key) => key.startsWith(`${domain}/`)).sort();
    const showChildren = childKeys.length > 1 || (childKeys.length === 1 && (subdomains.get(childKeys[0]!)?.length ?? 0) < members.length);
    const children: ClusterCircle[] = showChildren
      ? childKeys.map((key) => {
          const inside = subdomains.get(key) ?? [];
          const middle = centroid(inside);
          return { key, label: lastSegment(key), level: "subdomain", ...middle, r: ringAround(middle, inside, [], nodeSize, SUBDOMAIN_PAD), index };
        })
      : [];
    const middle = centroid(members);
    circles.push({ key: domain, label: domain, level: "domain", ...middle, r: ringAround(middle, members, children, nodeSize, DOMAIN_PAD), index }, ...children);
  });
  return circles;
}

// Edge points of every ring, so a fitted camera keeps whole circles (and the label above each) in view
export function circleExtents(circles: readonly ClusterCircle[], labelRoom: number): { x: number; y: number }[] {
  return circles.flatMap((circle) => [
    { x: circle.x - circle.r, y: circle.y },
    { x: circle.x + circle.r, y: circle.y },
    { x: circle.x, y: circle.y - circle.r - labelRoom },
    { x: circle.x, y: circle.y + circle.r },
  ]);
}
