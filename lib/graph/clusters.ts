import type { Force } from "d3-force";
import { nodeRadius, pullWeight, type SimLink, type SimNode } from "./physics";
import type { GraphNode } from "./types";

// =====================================================================
// DOMAIN CLUSTERS: groups dots by the domain tree. A node sits in its
// primary domain (its first domain path) and so in every domain above
// it: "Company/Health & Safety/PPE" puts it inside Company, inside
// Health & Safety, inside PPE. Every level gets a circle, nested. A
// force pulls each dot toward its deepest domain's spot, and spots are
// laid out level by level so sibling domains sit apart.
// =====================================================================

// GROUP: one domain in the tree, with the dots filed directly in it and its child domains
export interface ClusterGroup {
  path: string;
  label: string;
  depth: number;
  members: SimNode[];
  children: ClusterGroup[];
  // Dots in this domain and everything below it
  size: number;
}

// CIRCLE: one drawn ring in world units. `index` picks its color (shared by everything in one top-level
// domain); a branch holds child domains and is named above its ring, a leaf is named across its middle.
export interface ClusterCircle {
  key: string;
  label: string;
  depth: number;
  isBranch: boolean;
  x: number;
  y: number;
  r: number;
  index: number;
}

// SPACING in world units: room between dots and a leaf ring, and around child rings (with space for their names)
const LEAF_PAD = 14;
const BRANCH_PAD = 26;
// SPOT LAYOUT: rough size per dot, and the smallest ring child spots sit on
const RING_PER_DOT = 18;
const RING_MIN = 80;

// Segments of a node's primary domain path (empty when it has none)
function primarySegments(node: Pick<GraphNode, "domainPaths">): string[] {
  return ([...node.domainPaths].sort()[0] ?? "").split("/").filter(Boolean);
}

// TREE: the domains the visible dots sit in, top-level domains first, children sorted by name
export function clusterTree(nodes: readonly SimNode[]): ClusterGroup[] {
  const roots: ClusterGroup[] = [];
  const byPath = new Map<string, ClusterGroup>();
  for (const node of nodes) {
    let siblings = roots;
    let group: ClusterGroup | undefined;
    primarySegments(node).forEach((segment, depth, segments) => {
      const path = segments.slice(0, depth + 1).join("/");
      group = byPath.get(path);
      if (!group) {
        group = { path, label: segment, depth, members: [], children: [], size: 0 };
        byPath.set(path, group);
        siblings.push(group);
      }
      group.size += 1;
      siblings = group.children;
    });
    group?.members.push(node);
  }
  const sortTree = (groups: ClusterGroup[]) => {
    groups.sort((a, b) => a.label.localeCompare(b.label));
    groups.forEach((group) => sortTree(group.children));
  };
  sortTree(roots);
  return roots;
}

// The deepest domain path each dot sits in (dots without a domain are left out)
export function deepestPaths(nodes: readonly SimNode[]): Map<SimNode, string> {
  const paths = new Map<SimNode, string>();
  const walk = (group: ClusterGroup) => {
    for (const node of group.members) paths.set(node, group.path);
    group.children.forEach(walk);
  };
  clusterTree(nodes).forEach(walk);
  return paths;
}

// Middle of a set of dots
function centroid(nodes: readonly SimNode[]): { x: number; y: number } {
  const x = nodes.reduce((sum, node) => sum + (node.x ?? 0), 0) / nodes.length;
  const y = nodes.reduce((sum, node) => sum + (node.y ?? 0), 0) / nodes.length;
  return { x, y };
}

// Rough ring size for a group of `count` dots, used to space spots before the layout settles
const groupSize = (count: number) => RING_PER_DOT * Math.sqrt(count) + BRANCH_PAD;

function orbitRadius(sizes: readonly number[], inner: number): number {
  if (sizes.length === 1 && inner === 0) return 0;
  const largest = Math.max(0, ...sizes);
  const separation = sizes.length > 1
    ? Math.max(...sizes.map((size, i) => size + sizes[(i + 1) % sizes.length]! + 16)) / (2 * Math.sin(Math.PI / sizes.length))
    : 0;
  return Math.max(RING_MIN, inner + largest + 16, separation);
}

// SPOTS: groups evenly round a ring about `center`, the ring long enough that neighbors do not overlap.
// A lone group sits on the center itself; `inner` keeps the ring clear of dots held at the center.
function spotsAround(center: { x: number; y: number }, groups: readonly ClusterGroup[], inner: number): Map<ClusterGroup, { x: number; y: number }> {
  if (groups.length === 1 && inner === 0) return new Map([[groups[0]!, center]]);
  // Estimate from dot count; recursively reserving entire descendant rings
  // compounds empty space at every level and makes fitted dots too small.
  const sizes = groups.map((group) => groupSize(group.size));
  const ring = orbitRadius(sizes, inner);
  return new Map(groups.map((group, i) => {
    const angle = (i / groups.length) * Math.PI * 2 - Math.PI / 2;
    return [group, { x: center.x + Math.cos(angle) * ring, y: center.y + Math.sin(angle) * ring }];
  }));
}

// FORCE: each dot toward its deepest domain's spot. Strength 0 turns it off.
export function forceClusters(strength: number): Force<SimNode, undefined> {
  let targets = new Map<SimNode, { x: number; y: number }>();
  let memberGroups: SimNode[][] = [];

  const force = (alpha: number) => {
    if (strength <= 0) return;
    const pull = strength * alpha * 0.6;
    for (const [node, spot] of targets) {
      // Linked dots gather at the spot; orphans hang back toward the domain's edge
      const weighted = pull * pullWeight(node);
      node.vx = (node.vx ?? 0) + (spot.x - (node.x ?? 0)) * weighted;
      node.vy = (node.vy ?? 0) + (spot.y - (node.y ?? 0)) * weighted;
    }
    // Keep each domain's own dots together, even when sparse or unlinked.
    // Global targets and weak orphan pull alone let outliers inflate the rings.
    for (const members of memberGroups) {
      const middle = centroid(members);
      const room = 14 * Math.sqrt(members.length);
      for (const node of members) {
        const dx = middle.x - (node.x ?? 0), dy = middle.y - (node.y ?? 0);
        const distance = Math.hypot(dx, dy);
        if (distance <= room) continue;
        const cohesion = strength * alpha * 0.8 * (1 - room / distance);
        node.vx = (node.vx ?? 0) + dx * cohesion;
        node.vy = (node.vy ?? 0) + dy * cohesion;
      }
    }
  };

  force.initialize = (nodes: SimNode[]) => {
    targets = new Map();
    memberGroups = [];
    // Children round their parent's spot, clear of the parent's own dots at the center
    const place = (group: ClusterGroup, spot: { x: number; y: number }) => {
      if (group.members.length > 1) memberGroups.push(group.members);
      for (const node of group.members) targets.set(node, spot);
      if (group.children.length === 0) return;
      const spots = spotsAround(spot, group.children, group.members.length > 0 ? groupSize(group.members.length) : 0);
      for (const [child, childSpot] of spots) place(child, childSpot);
    };
    for (const [group, spot] of spotsAround({ x: 0, y: 0 }, clusterTree(nodes), 0)) place(group, spot);
  };
  return force;
}

// Smallest ring around the middle that holds every dot (and child ring), plus padding
function ringAround(middle: { x: number; y: number }, nodes: readonly SimNode[], children: readonly ClusterCircle[], nodeSize: number, pad: number): number {
  const fromDots = nodes.map((node) => Math.hypot((node.x ?? 0) - middle.x, (node.y ?? 0) - middle.y) + nodeRadius(node, nodeSize));
  const fromChildren = children.map((child) => Math.hypot(child.x - middle.x, child.y - middle.y) + child.r);
  return Math.max(0, ...fromDots, ...fromChildren) + pad;
}

// CIRCLES for the current positions, outermost first so inner rings draw on top
export function clusterCircles(nodes: readonly SimNode[], nodeSize: number): ClusterCircle[] {
  // Builds a group's ring from its children's, and returns it with every ring inside it
  const build = (group: ClusterGroup, index: number): { circle: ClusterCircle; all: ClusterCircle[]; dots: SimNode[] } => {
    const inner = group.children.map((child) => build(child, index));
    const dots = [...group.members, ...inner.flatMap((child) => child.dots)];
    let middle = centroid(dots);
    const isBranch = group.children.length > 0;
    const children = inner.map((child) => child.circle);
    const pad = isBranch ? BRANCH_PAD : LEAF_PAD;
    let r = ringAround(middle, group.members, children, nodeSize, pad);
    // A centroid favors dense pockets: one distant dot can double the ring's
    // empty area. Fit the actual discs instead, including complete child rings.
    const discs = [
      ...group.members.map((node) => ({ x: node.x ?? 0, y: node.y ?? 0, r: nodeRadius(node, nodeSize) })),
      ...children,
    ];
    if (discs.length > 0) {
      const fitted = { ...discs[0]! };
      for (const disc of discs.slice(1)) {
        const dx = disc.x - fitted.x, dy = disc.y - fitted.y;
        const distance = Math.hypot(dx, dy);
        if (distance + disc.r <= fitted.r) continue;
        if (distance + fitted.r <= disc.r) {
          Object.assign(fitted, { x: disc.x, y: disc.y, r: disc.r });
          continue;
        }
        const nextRadius = (fitted.r + distance + disc.r) / 2;
        const shift = (nextRadius - fitted.r) / distance;
        fitted.x += dx * shift;
        fitted.y += dy * shift;
        fitted.r = nextRadius;
      }
      if (fitted.r + pad < r) {
        middle = { x: fitted.x, y: fitted.y };
        r = fitted.r + pad;
      }
    }
    const circle = { key: group.path, label: group.label, depth: group.depth, isBranch, ...middle, r, index };
    return { circle, all: [circle, ...inner.flatMap((child) => child.all)], dots };
  };
  return clusterTree(nodes).flatMap((group, index) => build(group, index).all);
}

// Move whole root groups apart using their actual drawn bounds. Moving every
// member equally preserves the compact arrangement inside each root.
export function separateRootDomains(nodes: SimNode[], nodeSize: number, links: readonly SimLink[] = []): void {
  const depth = Math.max(0, ...nodes.map((node) => primarySegments(node).length - 1));
  // Separate children first, then recompute their parents' expanded bounds.
  for (let level = depth; level >= 0; level--) separateDomainsAtDepth(nodes, nodeSize, links, level);
}

function separateDomainsAtDepth(nodes: SimNode[], nodeSize: number, links: readonly SimLink[], depth: number): void {
  const roots = clusterCircles(nodes, nodeSize).filter((circle) => circle.depth === depth);
  const groups = roots.map((circle) => ({
    circle,
    parentPath: circle.key.split("/").slice(0, -1).join("/"),
    nodes: nodes.filter((node) => {
      const path = primarySegments(node).join("/");
      return path === circle.key || path.startsWith(`${circle.key}/`);
    }),
  }));
  // Parent-level claims are not members of any child. Reserve their actual
  // bounds alongside the child circles so a summary hub cannot appear inside
  // a subject it does not belong to. This obstacle is never drawn as a domain.
  for (const parentPath of new Set(groups.map(group => group.parentPath))) {
    if (!parentPath) continue;
    const members = nodes.filter(node => primarySegments(node).join("/") === parentPath);
    if (!members.length) continue;
    const circle = clusterCircles(members, nodeSize).find(group => group.key === parentPath)!;
    groups.push({ circle, parentPath, nodes: members });
  }
  const rootByNode = new Map(nodes.map((node) => [node.id, primarySegments(node)[0]]));
  const connectionWeight = new Map<string, number>();
  const pairKey = (a: string, b: string) => JSON.stringify([a, b].sort());
  for (const link of links) {
    const a = rootByNode.get(typeof link.source === "object" ? link.source.id! : String(link.source));
    const b = rootByNode.get(typeof link.target === "object" ? link.target.id! : String(link.target));
    if (!a || !b || a === b) continue;
    const key = pairKey(a, b);
    connectionWeight.set(key, (connectionWeight.get(key) ?? 0) + (link.kind === "similar" ? 0.25 : 1));
  }
  const move = (group: typeof groups[number], dx: number, dy: number) => {
    group.circle.x += dx;
    group.circle.y += dy;
    for (const node of group.nodes) {
      node.x = (node.x ?? 0) + dx;
      node.y = (node.y ?? 0) + dy;
    }
  };
  for (let pass = 0; pass < 32; pass++) {
    let largestOverlap = 0;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i]!, b = groups[j]!;
      // Only siblings share a container; cousins are handled by their parents.
      if (a.parentPath !== b.parentPath) continue;
      const dx = b.circle.x - a.circle.x, dy = b.circle.y - a.circle.y;
      const distance = Math.hypot(dx, dy);
      // Many cross-domain connections relax the boundary; similarity links
      // count less than explicit relationships. Internal link forces can
      // still stretch each group toward its neighbors.
      const weight = depth === 0 ? connectionWeight.get(pairKey(a.circle.key, b.circle.key)) ?? 0 : 0;
      const affinity = Math.min(1, weight / Math.max(1, Math.min(a.nodes.length, b.nodes.length)));
      const gap = 32 * (1 - affinity);
      const sharedSpace = Math.min(a.circle.r, b.circle.r) * 0.35 * affinity;
      const overlap = a.circle.r + b.circle.r + gap - sharedSpace - distance;
      if (overlap <= 0) continue;
      const pinnedA = a.nodes.some((node) => node.fx != null || node.fy != null);
      const pinnedB = b.nodes.some((node) => node.fx != null || node.fy != null);
      if (pinnedA && pinnedB) continue;
      largestOverlap = Math.max(largestOverlap, overlap);
      const ux = distance > 0 ? dx / distance : 1;
      const uy = distance > 0 ? dy / distance : 0;
      const shareA = pinnedA ? 0 : pinnedB ? 1 : 0.5;
      move(a, -ux * overlap * shareA, -uy * overlap * shareA);
      move(b, ux * overlap * (1 - shareA), uy * overlap * (1 - shareA));
    }
    if (largestOverlap < 0.1) break;
  }
}

export function forceRootSeparation(nodeSize: number, links: readonly SimLink[] = []): Force<SimNode, undefined> {
  let nodes: SimNode[] = [];
  const force = () => separateRootDomains(nodes, nodeSize, links);
  force.initialize = (value: SimNode[]) => { nodes = value; };
  return force;
}

// Edge points of every ring, so a fitted camera keeps whole circles (and the name above each) in view
export function circleExtents(circles: readonly ClusterCircle[], labelRoom: number): { x: number; y: number }[] {
  return circles.flatMap((circle) => [
    { x: circle.x - circle.r, y: circle.y },
    { x: circle.x + circle.r, y: circle.y },
    { x: circle.x, y: circle.y - circle.r - labelRoom },
    { x: circle.x, y: circle.y + circle.r },
  ]);
}
