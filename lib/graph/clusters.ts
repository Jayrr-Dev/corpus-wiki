import { packEnclose, packSiblings } from "d3-hierarchy";
import { nodeRadius, type SimNode } from "./physics";
import type { GraphNode } from "./types";

// =====================================================================
// DOMAIN CLUSTERS: groups dots by the domain tree. A node sits in its
// primary domain (its first domain path) and so in every domain above
// it: "Company/Health & Safety/PPE" puts it inside Company, inside
// Health & Safety, inside PPE. Every level gets a circle, nested.
// Circles are packed (d3's circle packing) before any dot moves: an
// innermost domain is sized from its dots, siblings pack tightly side
// by side, and each parent is just big enough for its children. Each
// dot is then kept inside its own circle, so links arrange dots within
// a domain but never stretch one domain toward another.
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

// Segments of a node's primary domain path (empty when it has none)
export function primarySegments(node: Pick<GraphNode, "domainPaths">): string[] {
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

// SPACING in world units: room per dot inside an innermost ring (its radius plus this, squared, times
// the looseness, so dots and their links have space to move), the smallest spot, padding inside an
// innermost ring and around child rings (with space for their names), and the gap between siblings
const DOT_ROOM = 6;
const LOOSENESS = 1.6;
const SPOT_MIN = 18;
const LEAF_PAD = 8;
const BRANCH_PAD = 16;
const SIBLING_GAP = 10;

// HOME: the circle a dot is kept inside (its innermost ring, or an undrawn spot inside a parent
// ring for dots filed directly in a domain that also has child domains)
export interface Home {
  x: number;
  y: number;
  r: number;
}

// PACKING: the drawn rings (outermost first) and each dot's home, by node id
export interface DomainPacking {
  circles: ClusterCircle[];
  homes: Map<string, Home>;
}

// One packed circle, its position relative to its parent's middle until placed
interface Packed {
  x: number;
  y: number;
  r: number;
  group?: ClusterGroup;
  // Dots that live in this circle, and how far inside its ring they stay
  dots?: readonly SimNode[];
  inset?: number;
  items: Packed[];
}

// Radius of a spot that holds these dots with room to move
function spotRadius(dots: readonly SimNode[], nodeSize: number): number {
  const area = dots.reduce((sum, node) => sum + (nodeRadius(node, nodeSize) + DOT_ROOM) ** 2, 0);
  return Math.max(SPOT_MIN, Math.sqrt(LOOSENESS * area));
}

// Packs circles side by side with a gap and centers them on their enclosing circle, whose radius it returns
function packAround(items: Packed[]): number {
  for (const item of items) item.r += SIBLING_GAP / 2;
  packSiblings(items);
  const enclosing = packEnclose(items);
  for (const item of items) {
    item.r -= SIBLING_GAP / 2;
    item.x -= enclosing.x;
    item.y -= enclosing.y;
  }
  return enclosing.r - SIBLING_GAP / 2;
}

// A domain's circle: an innermost domain holds its dots; a parent packs its child rings plus, when it
// has dots of its own, one undrawn spot for them
function packGroup(group: ClusterGroup, nodeSize: number): Packed {
  if (group.children.length === 0) {
    return { x: 0, y: 0, r: spotRadius(group.members, nodeSize) + LEAF_PAD, group, dots: group.members, inset: LEAF_PAD, items: [] };
  }
  const items = group.children.map((child) => packGroup(child, nodeSize));
  if (group.members.length > 0) items.push({ x: 0, y: 0, r: spotRadius(group.members, nodeSize), dots: group.members, inset: 0, items: [] });
  return { x: 0, y: 0, r: packAround(items) + BRANCH_PAD, group, items };
}

// The last packing, reused while the same dots ask again (every frame and every layout step do)
let lastPacking: { nodes: readonly SimNode[]; nodeSize: number; packing: DomainPacking } | null = null;

// PACK: rings and homes for these dots, centered on the world origin. Dots without a domain share
// one undrawn spot beside the top-level domains.
export function packDomains(nodes: readonly SimNode[], nodeSize: number): DomainPacking {
  if (lastPacking?.nodes === nodes && lastPacking.nodeSize === nodeSize) return lastPacking.packing;
  const tree = clusterTree(nodes);
  const filed = deepestPaths(nodes);
  const loose = nodes.filter((node) => !filed.has(node));
  const top = tree.map((group) => packGroup(group, nodeSize));
  if (loose.length > 0) top.push({ x: 0, y: 0, r: spotRadius(loose, nodeSize), dots: loose, inset: 0, items: [] });
  if (top.length > 0) packAround(top);
  const packing: DomainPacking = { circles: [], homes: new Map() };
  const place = (item: Packed, originX: number, originY: number, index: number) => {
    const x = originX + item.x, y = originY + item.y;
    const { group } = item;
    if (group) packing.circles.push({ key: group.path, label: group.label, depth: group.depth, isBranch: group.children.length > 0, x, y, r: item.r, index });
    if (item.dots) {
      const home = { x, y, r: item.r - (item.inset ?? 0) };
      for (const node of item.dots) packing.homes.set(node.id, home);
    }
    for (const child of item.items) place(child, x, y, index);
  };
  top.forEach((item, index) => place(item, 0, 0, index));
  lastPacking = { nodes, nodeSize, packing };
  return packing;
}

// CIRCLES for these dots, outermost first so inner rings draw on top. They depend on which dots sit
// in which domain (and their sizes), not on where the dots are.
export function clusterCircles(nodes: readonly SimNode[], nodeSize: number): ClusterCircle[] {
  return packDomains(nodes, nodeSize).circles;
}

// Spread for a dot placed fresh in its home: a golden-angle spiral by its index, so new dots start apart
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// CONTAINMENT: run after each layout step. Puts a dot that drifted out of its home back on the home's
// edge, and a dot far outside it (a fresh start, or a home that moved) somewhere inside it. Dragged
// dots stay where the pointer holds them.
export function createContainment(nodes: readonly SimNode[], nodeSize: number): () => void {
  const { homes } = packDomains(nodes, nodeSize);
  return () => {
    nodes.forEach((node, i) => {
      const home = homes.get(node.id);
      if (!home || node.fx != null || node.fy != null) return;
      const room = Math.max(0, home.r - nodeRadius(node, nodeSize));
      const dx = (node.x ?? 0) - home.x, dy = (node.y ?? 0) - home.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= room) return;
      if (distance > home.r * 2) {
        const angle = i * GOLDEN_ANGLE, reach = room * 0.8 * Math.sqrt((i * 0.618034) % 1 || 0.5);
        node.x = home.x + Math.cos(angle) * reach;
        node.y = home.y + Math.sin(angle) * reach;
      } else {
        node.x = home.x + (dx / distance) * room;
        node.y = home.y + (dy / distance) * room;
      }
      node.vx = 0;
      node.vy = 0;
    });
  };
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
