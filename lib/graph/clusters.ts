import type { Force } from "d3-force";
import { nodeRadius, type SimNode } from "./physics";
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
const LEAF_PAD = 10;
const BRANCH_PAD = 26;
// SPOT LAYOUT: rough size per dot, and the smallest ring child spots sit on
const RING_PER_DOT = 14;
const RING_MIN = 60;

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

// SPOTS: groups evenly round a ring about `center`, the ring long enough that neighbors do not overlap.
// A lone group sits on the center itself; `inner` keeps the ring clear of dots held at the center.
function spotsAround(center: { x: number; y: number }, groups: readonly ClusterGroup[], inner: number): Map<ClusterGroup, { x: number; y: number }> {
  if (groups.length === 1 && inner === 0) return new Map([[groups[0]!, center]]);
  const sizes = groups.map((group) => groupSize(group.size));
  const ring = Math.max(RING_MIN, inner + Math.max(0, ...sizes), sizes.reduce((sum, size) => sum + size * 2, 0) / (Math.PI * 2));
  return new Map(groups.map((group, i) => {
    const angle = (i / groups.length) * Math.PI * 2 - Math.PI / 2;
    return [group, { x: center.x + Math.cos(angle) * ring, y: center.y + Math.sin(angle) * ring }];
  }));
}

// FORCE: each dot toward its deepest domain's spot. Strength 0 turns it off.
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
    targets = new Map();
    // Children round their parent's spot, clear of the parent's own dots at the center
    const place = (group: ClusterGroup, spot: { x: number; y: number }) => {
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
    const middle = centroid(dots);
    const isBranch = group.children.length > 0;
    const children = inner.map((child) => child.circle);
    const r = ringAround(middle, group.members, children, nodeSize, isBranch ? BRANCH_PAD : LEAF_PAD);
    const circle = { key: group.path, label: group.label, depth: group.depth, isBranch, ...middle, r, index };
    return { circle, all: [circle, ...inner.flatMap((child) => child.all)], dots };
  };
  return clusterTree(nodes).flatMap((group, index) => build(group, index).all);
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
