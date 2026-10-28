import { packEnclose, packSiblings } from "d3-hierarchy";
import {
  GROUPINGS,
  isReservedCircleLabel,
  NO_ARTICLE_LABEL,
  PAGE_SEP,
  type CircleOpenTarget,
  type GroupingId,
  type LinkEnd,
  type PlacedNode,
} from "./groupings";
import type { GraphColor } from "./groups";
import {
  centersGrouping,
  hasHubBody,
  isContent,
  NODE_TYPE_LIST,
} from "./nodeTypes";
import { nodeRadius, type SimNode } from "./physics";
import type { GraphNode } from "./types";

export {
  EXTERNAL_LABEL,
  LINKED_LABEL,
  NO_ARTICLE_LABEL,
  ORPHANS_LABEL,
  primaryEntityName,
  primaryPageTitle,
  primaryStakeholderName,
  type CircleOpenTarget,
} from "./groupings";

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
// Other groupings follow the rules in their GROUPINGS entry (entity: one flat circle per name;
// page: each section inside its article, plus a gray "No article" circle). A node that centers
// the active grouping is a separate layer: it is placed at its circle's center, and the ring
// grows so the whole bubble sits inside it.
// =====================================================================

// Which circle a dot sits in. Each grouping's rules are in its GROUPINGS entry.
export type ClusterMode = GroupingId;

// Circle key for one section inside an article. Titles may contain "/".
export function pageSectionKey(page: string, section: string): string {
  return `${page}${PAGE_SEP}${section}`;
}

export function circleNestedIn(
  childKey: string,
  parentKey: string,
  mode: ClusterMode,
): boolean {
  const rule = GROUPINGS[mode];
  if (!rule.nests) return false;
  return childKey.startsWith(`${parentKey}${rule.separator}`);
}

// GROUP: one domain in the tree, with the dots filed directly in it and its child domains
export interface ClusterGroup {
  path: string;
  label: string;
  depth: number;
  // Path of the domain above this one ("" at the top). Kept whole so an entity name can contain "/".
  parent: string;
  members: SimNode[];
  children: ClusterGroup[];
  // Section order inside an article. Page and domain circles leave this at 0.
  order: number;
  // Dots in this domain and everything below it
  size: number;
  // Nested under No article around the most-connected dot. No ring and no name.
  quiet?: boolean;
}

// CIRCLE: one drawn ring in world units. `index` picks its color (shared by everything in one top-level
// domain); a branch holds child domains and is named above its ring, a leaf is named across its middle.
export interface ClusterCircle {
  key: string;
  label: string;
  depth: number;
  parent: string;
  isBranch: boolean;
  x: number;
  y: number;
  r: number;
  // Notes in this circle and everything inside it. Group names grow with this.
  count: number;
  index: number;
  // Set for entity/page circles so the ring matches the dots inside it
  color?: GraphColor;
  // Shown on a suggestion circle: a new article, or units joining an existing one
  badge?: "Merge" | "New Article";
  // When this article or section was created. Page mode only.
  createdAt?: string;
  // Nested under No article. The nodes group around the most-connected dot.
  // The No article circle itself still draws.
  quiet?: boolean;
}

// What a second click on an already selected circle opens (page circles only today)
export function circleOpenTarget(
  circle: { label: string; parent: string },
  mode: ClusterMode,
): CircleOpenTarget | null {
  return GROUPINGS[mode].openTarget?.(circle) ?? null;
}

type ClusterNode = PlacedNode;

function joinPath(segments: readonly string[], mode: ClusterMode): string {
  return segments.join(GROUPINGS[mode].separator);
}

// Segments of the circle path, from the grouping's own rule
function clusterSegments(
  node: ClusterNode,
  mode: ClusterMode,
  hubs: ReadonlyMap<string, string> | null = null,
): string[] {
  return GROUPINGS[mode].segments(node, hubs);
}

// Circle key for the dot's own ring (null when it sits in no circle)
export function clusterKey(
  node: ClusterNode,
  mode: ClusterMode,
): string | null {
  const segments = clusterSegments(node, mode);
  return segments.length ? joinPath(segments, mode) : null;
}

// Dots and circles a selected circle reaches by a link. Members of the
// selected circle are left out; nested ancestors that also hold the
// selection stay out so only the groups on the other side light up.
export function clusterConnections(
  nodes: readonly (ClusterNode & { id: string })[],
  links: readonly { source: string; target: string }[],
  key: string,
  mode: ClusterMode,
): { nodeIds: ReadonlySet<string>; circleKeys: ReadonlySet<string> } {
  const members = new Set(
    nodes
      .filter((node) => nodeInCluster(node, key, mode))
      .map((node) => node.id),
  );
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const nodeIds = new Set<string>();
  const circleKeys = new Set<string>();
  const { nests, separator: sep } = GROUPINGS[mode];
  for (const link of links) {
    const sourceIn = members.has(link.source);
    const targetIn = members.has(link.target);
    if (sourceIn === targetIn) continue;
    const outside = byId.get(sourceIn ? link.target : link.source);
    if (!outside) continue;
    nodeIds.add(outside.id);
    const segments = clusterSegments(outside, mode);
    for (let depth = 0; depth < segments.length; depth++) {
      const circleKey = joinPath(segments.slice(0, depth + 1), mode);
      if (circleKey === key || key.startsWith(`${circleKey}${sep}`)) continue;
      if (nests && circleKey.startsWith(`${key}${sep}`)) continue;
      circleKeys.add(circleKey);
    }
  }
  return { nodeIds, circleKeys };
}

// True when this dot belongs in the focused circle
export function nodeInCluster(
  node: ClusterNode,
  key: string,
  mode: ClusterMode,
): boolean {
  return GROUPINGS[mode].holds(node, key);
}

// Segments of a node's primary domain path (empty when it has none)
export function primarySegments(
  node: Pick<GraphNode, "domainPaths">,
): string[] {
  return ([...node.domainPaths].sort()[0] ?? "").split("/").filter(Boolean);
}

// TREE: the circles the visible dots sit in, top level first, siblings in the grouping's order
export function clusterTree(
  nodes: readonly SimNode[],
  mode: ClusterMode = "domain",
  hubs: ReadonlyMap<string, string> | null = null,
): ClusterGroup[] {
  const rule = GROUPINGS[mode];
  const hubIds = new Set(
    [...(hubs?.values() ?? [])].filter(
      (value) => !isReservedCircleLabel(value),
    ),
  );
  const hubTitles = new Map<string, string>();
  for (const node of nodes) {
    const title = node.label?.trim();
    if (node.id && title && hubIds.has(node.id)) hubTitles.set(node.id, title);
  }
  const roots: ClusterGroup[] = [];
  const byPath = new Map<string, ClusterGroup>();
  for (const node of nodes) {
    const centered = centersGrouping(node, mode);
    let siblings = roots;
    let group: ClusterGroup | undefined;
    clusterSegments(node, mode, hubs).forEach((segment, depth, segments) => {
      const path = joinPath(segments.slice(0, depth + 1), mode);
      group = byPath.get(path);
      const order = rule.order?.(node, segments, depth) ?? 0;
      if (!group) {
        group = {
          path,
          label: hubIds.has(segment)
            ? (hubTitles.get(segment) ?? segment)
            : segment,
          depth,
          parent: joinPath(segments.slice(0, depth), mode),
          members: [],
          children: [],
          size: 0,
          order,
          quiet:
            segments[0] === NO_ARTICLE_LABEL && hubIds.has(segment)
              ? true
              : undefined,
        };
        byPath.set(path, group);
        siblings.push(group);
      } else if (rule.order && depth > 0)
        group.order = Math.min(group.order, order);
      group.size += 1;
      siblings = group.children;
    });
    // The centered node is placed at the circle center later. It is not one of the notes in the circle.
    if (!centered) group?.members.push(node);
  }
  const sortTree = (groups: ClusterGroup[]) => {
    groups.sort(rule.compare);
    groups.forEach((group) => sortTree(group.children));
  };
  sortTree(roots);
  return roots;
}

// The deepest domain path each dot sits in (dots without a domain are left out)
export function deepestPaths(
  nodes: readonly SimNode[],
  mode: ClusterMode = "domain",
  hubs: ReadonlyMap<string, string> | null = null,
): Map<SimNode, string> {
  const paths = new Map<SimNode, string>();
  const walk = (group: ClusterGroup) => {
    for (const node of group.members) paths.set(node, group.path);
    group.children.forEach(walk);
  };
  clusterTree(nodes, mode, hubs).forEach(walk);
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
// Air between a domain bubble's edge and its group ring. Scales with node size so a big hub still clears the ring.
function domainRingGap(nodeSize: number): number {
  return Math.max(6, nodeSize * 8);
}

// HOME: the circle a dot is kept inside (its innermost ring, or an undrawn spot inside a parent
// ring for dots filed directly in a domain that also has child domains)
export interface Home {
  x: number;
  y: number;
  r: number;
  // Domain hub pinned at the middle of its topic circle
  pin?: boolean;
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
  const area = dots.reduce(
    (sum, node) => sum + (nodeRadius(node, nodeSize) + DOT_ROOM) ** 2,
    0,
  );
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

// Radius of each centered bubble, by its circle key. The ring must clear this edge.
function centeredRadii(
  nodes: readonly SimNode[],
  nodeSize: number,
  mode: ClusterMode,
): Map<string, number> {
  const radii = new Map<string, number>();
  for (const node of nodes) {
    if (!centersGrouping(node, mode)) continue;
    const key = clusterKey(node, mode);
    if (!key) continue;
    radii.set(key, nodeRadius(node, nodeSize));
  }
  return radii;
}

// A domain's circle: an innermost domain holds its notes; a parent packs its child rings plus, when it
// has notes of its own, one undrawn spot for them. The ring is at least big enough for that topic's
// domain bubble, with a gap so the bubble does not sit on the line.
function packGroup(
  group: ClusterGroup,
  nodeSize: number,
  hubs: ReadonlyMap<string, number>,
): Packed {
  const fit = (radius: number) =>
    Math.max(radius, (hubs.get(group.path) ?? 0) + domainRingGap(nodeSize));
  if (group.children.length === 0) {
    return {
      x: 0,
      y: 0,
      r: fit(spotRadius(group.members, nodeSize) + LEAF_PAD),
      group,
      dots: group.members,
      inset: LEAF_PAD,
      items: [],
    };
  }
  const items = group.children.map((child) => packGroup(child, nodeSize, hubs));
  if (group.members.length > 0)
    items.push({
      x: 0,
      y: 0,
      r: spotRadius(group.members, nodeSize),
      dots: group.members,
      inset: 0,
      items: [],
    });
  return { x: 0, y: 0, r: fit(packAround(items) + BRANCH_PAD), group, items };
}

// After a centered bubble has settled, grow its ring (and each parent ring) so the bubble stays inside.
function fitCirclesAroundCenters(
  circles: ClusterCircle[],
  nodes: readonly SimNode[],
  nodeSize: number,
  mode: ClusterMode,
): void {
  const gap = domainRingGap(nodeSize);
  const byKey = new Map(circles.map((circle) => [circle.key, circle]));
  for (const node of nodes) {
    if (!centersGrouping(node, mode)) continue;
    const key = clusterKey(node, mode);
    const circle = key ? byKey.get(key) : undefined;
    if (!circle) continue;
    const need =
      Math.hypot((node.x ?? 0) - circle.x, (node.y ?? 0) - circle.y) +
      nodeRadius(node, nodeSize) +
      gap;
    if (need > circle.r) circle.r = need;
  }
  const ordered = [...circles].sort((a, b) => b.depth - a.depth);
  for (const circle of ordered) {
    const parent = byKey.get(circle.parent);
    if (!parent) continue;
    const need =
      Math.hypot(circle.x - parent.x, circle.y - parent.y) + circle.r + gap;
    if (need > parent.r) parent.r = need;
  }
}

// Nodes that center this grouping are a separate layer. When their own circle exists
// (found through the grouping's segments), the node sits at its center.
function pinCenteredNodes(
  packing: DomainPacking,
  nodes: readonly SimNode[],
  mode: ClusterMode,
): void {
  const byKey = new Map(packing.circles.map((circle) => [circle.key, circle]));
  for (const node of nodes) {
    if (!centersGrouping(node, mode)) continue;
    const key = clusterKey(node, mode);
    const circle = key ? byKey.get(key) : undefined;
    if (!circle) continue;
    packing.homes.set(node.id, {
      x: circle.x,
      y: circle.y,
      r: circle.r,
      pin: true,
    });
  }
}

// Shared default so calls without links hit the packing cache (a fresh [] never matches it)
const NO_LINKS: readonly never[] = [];

// The last packing, reused while the same dots ask again (every frame and every layout step do)
let lastPacking: {
  nodes: readonly SimNode[];
  nodeSize: number;
  mode: ClusterMode;
  links: readonly {
    source: LinkEnd;
    target: LinkEnd;
  }[];
  packing: DomainPacking;
} | null = null;

// PACK: rings and homes for these dots, centered on the world origin. Dots without a domain share
// one undrawn spot beside the top-level domains. In page mode, dots with no article form a
// "No article" circle instead of that spot.
export function packDomains(
  nodes: readonly SimNode[],
  nodeSize: number,
  mode: ClusterMode = "domain",
  links: readonly {
    source: LinkEnd;
    target: LinkEnd;
  }[] = NO_LINKS,
): DomainPacking {
  if (
    lastPacking?.nodes === nodes &&
    lastPacking.nodeSize === nodeSize &&
    lastPacking.mode === mode &&
    lastPacking.links === links
  )
    return lastPacking.packing;
  const rule = GROUPINGS[mode];
  const hubs = rule.subgroups?.(nodes, links) ?? null;
  const hubRadii = centeredRadii(nodes, nodeSize, mode);
  const tree = clusterTree(nodes, mode, hubs);
  const filed = deepestPaths(nodes, mode, hubs);
  const loose = nodes.filter(
    (node) =>
      !hasHubBody(node) && !centersGrouping(node, mode) && !filed.has(node),
  );
  const top = tree.map((group) => packGroup(group, nodeSize, hubRadii));
  if (loose.length > 0)
    top.push({
      x: 0,
      y: 0,
      r: spotRadius(loose, nodeSize),
      dots: loose,
      inset: 0,
      items: [],
    });
  if (top.length > 0) packAround(top);
  const packing: DomainPacking = { circles: [], homes: new Map() };
  const place = (
    item: Packed,
    originX: number,
    originY: number,
    index: number,
  ) => {
    const x = originX + item.x,
      y = originY + item.y;
    const { group } = item;
    if (group) {
      packing.circles.push({
        key: group.path,
        label: group.label,
        depth: group.depth,
        parent: group.parent,
        isBranch: group.children.length > 0,
        x,
        y,
        r: item.r,
        count: group.size,
        index,
        badge: rule.badge?.(group),
        quiet: group.quiet,
        color: rule.color?.(group),
        createdAt: rule.createdAt?.(nodes, group),
      });
    }
    if (item.dots) {
      const home = { x, y, r: item.r - (item.inset ?? 0) };
      for (const node of item.dots) packing.homes.set(node.id, home);
    }
    for (const child of item.items) place(child, x, y, index);
  };
  top.forEach((item, index) => place(item, 0, 0, index));
  pinCenteredNodes(packing, nodes, mode);
  lastPacking = { nodes, nodeSize, mode, links, packing };
  return packing;
}

// CIRCLES for these dots, outermost first so inner rings draw on top. They depend on which dots sit
// in which domain (and their sizes), not on where the dots are.
export function clusterCircles(
  nodes: readonly SimNode[],
  nodeSize: number,
  mode: ClusterMode = "domain",
  links: readonly {
    source: LinkEnd;
    target: LinkEnd;
  }[] = NO_LINKS,
): ClusterCircle[] {
  return packDomains(nodes, nodeSize, mode, links).circles;
}

// The innermost ring under a point (a parent contains its children, so the deepest one is the drop)
export function circleAt(
  circles: readonly ClusterCircle[],
  point: { x: number; y: number },
): ClusterCircle | null {
  let hit: ClusterCircle | null = null;
  for (const circle of circles) {
    if (circle.quiet) continue;
    if (Math.hypot(point.x - circle.x, point.y - circle.y) > circle.r) continue;
    if (
      !hit ||
      circle.depth > hit.depth ||
      (circle.depth === hit.depth && circle.r < hit.r)
    )
      hit = circle;
  }
  return hit;
}

// The domain a dragged claim would join. The same domain, a non-claim, or a circle outside the
// focused branch stays put. A parent of the focus still counts, so a claim can move up a level.
export function moveTarget(
  node: Pick<GraphNode, "kind" | "domainPaths">,
  hit: Pick<ClusterCircle, "key"> | null,
  focusedDomain: string | null,
): string | null {
  if (!isContent(node) || !hit) return null;
  const source = [...node.domainPaths].sort()[0] ?? "";
  if (hit.key === source) return null;
  if (
    focusedDomain &&
    hit.key !== focusedDomain &&
    !hit.key.startsWith(`${focusedDomain}/`) &&
    !focusedDomain.startsWith(`${hit.key}/`)
  )
    return null;
  return hit.key;
}

// Where a dragged claim would go in page grouping: an article, one of its sections,
// or a suggestion circle inside No article (a new article, or a merge).
export type PageDrop =
  | { kind: "article"; page: string }
  | { kind: "section"; page: string; section: string }
  | { kind: "suggestion"; title: string; merge: boolean };

// The same home, a non-claim, the No article catch-all, or a circle outside the
// focused branch stays put. A parent of the focus still counts.
export function pageMoveTarget(
  node: Pick<
    GraphNode,
    | "kind"
    | "pageTitles"
    | "pageSections"
    | "recommendedTitle"
    | "recommendedKind"
  >,
  hit: Pick<ClusterCircle, "key" | "label" | "parent" | "badge"> | null,
  focusedKey: string | null,
): PageDrop | null {
  if (!isContent(node) || !hit) return null;
  if (!pageFocusAllows(hit.key, focusedKey)) return null;
  if (
    clusterKey({ ...node, domainPaths: [], entityNames: [] }, "page") ===
    hit.key
  )
    return null;
  if (hit.parent === "" && hit.label === NO_ARTICLE_LABEL) return null;
  if (hit.parent === NO_ARTICLE_LABEL) {
    if (isReservedCircleLabel(hit.label)) return null;
    return {
      kind: "suggestion",
      title: hit.label,
      merge: hit.badge === "Merge",
    };
  }
  if (hit.parent === "") {
    if ((node.pageTitles ?? []).includes(hit.label)) return null;
    return { kind: "article", page: hit.label };
  }
  return { kind: "section", page: hit.parent, section: hit.label };
}

export function pageDropLabel(drop: PageDrop): string {
  if (drop.kind === "article") return drop.page;
  if (drop.kind === "section") return `${drop.section} in ${drop.page}`;
  return drop.merge ? `Merge into ${drop.title}` : drop.title;
}

function pageFocusAllows(hitKey: string, focused: string | null): boolean {
  if (!focused) return true;
  if (hitKey === focused) return true;
  if (hitKey.startsWith(`${focused}${PAGE_SEP}`)) return true;
  return focused.startsWith(`${hitKey}${PAGE_SEP}`);
}

// Spread for a dot placed fresh in its home: a golden-angle spiral by its index, so new dots start apart
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
// A note outside this circle still tugs the centered node, but only this much of an inside note
const OUTSIDE_DOMAIN_PULL = 0.03;
const OVERLAP_PAD = 2;
const SEPARATE_PASSES = 4;

function pushApart(
  left: SimNode,
  right: SimNode,
  nodeSize: number,
  share: number,
): void {
  const needed =
    nodeRadius(left, nodeSize) + nodeRadius(right, nodeSize) + OVERLAP_PAD * 2;
  let dx = (right.x ?? 0) - (left.x ?? 0);
  let dy = (right.y ?? 0) - (left.y ?? 0);
  let distance = Math.hypot(dx, dy);
  if (distance >= needed) return;
  if (distance < 1e-4) {
    dx = 1;
    dy = 0;
    distance = 1;
  }
  const scale = (needed - distance) / distance;
  left.x = (left.x ?? 0) - dx * scale * share;
  left.y = (left.y ?? 0) - dy * scale * share;
  right.x = (right.x ?? 0) + dx * scale * (1 - share);
  right.y = (right.y ?? 0) + dy * scale * (1 - share);
  left.vx = 0;
  left.vy = 0;
  right.vx = 0;
  right.vy = 0;
}

// Centered nodes settle apart first. Notes are then moved out of those discs.
function separateOverlaps(
  nodes: readonly SimNode[],
  nodeSize: number,
  mode: ClusterMode,
): void {
  const domains = nodes.filter(
    (node) => centersGrouping(node, mode) && node.fx == null,
  );
  for (let pass = 0; pass < SEPARATE_PASSES; pass++) {
    for (let i = 0; i < domains.length; i++) {
      for (let j = i + 1; j < domains.length; j++) {
        const left = domains[i];
        const right = domains[j];
        if (!left || !right) continue;
        const leftRadius = nodeRadius(left, nodeSize);
        const rightRadius = nodeRadius(right, nodeSize);
        // The larger domain stays in the middle of its notes. The smaller one moves aside.
        const share =
          leftRadius === rightRadius ? 0.5 : leftRadius > rightRadius ? 0 : 1;
        pushApart(left, right, nodeSize, share);
      }
    }
  }
  const overlaps = (domain: SimNode, other: SimNode) => {
    const needed =
      nodeRadius(domain, nodeSize) +
      nodeRadius(other, nodeSize) +
      OVERLAP_PAD * 2;
    return (
      needed -
      Math.hypot(
        (other.x ?? 0) - (domain.x ?? 0),
        (other.y ?? 0) - (domain.y ?? 0),
      )
    );
  };
  for (const other of nodes) {
    if (centersGrouping(other, mode) || other.fx != null) continue;
    for (let pass = 0; pass < SEPARATE_PASSES; pass++) {
      let hit: SimNode | undefined;
      let overlap = 0;
      for (const domain of domains) {
        const next = overlaps(domain, other);
        if (next > overlap) {
          overlap = next;
          hit = domain;
        }
      }
      if (!hit || overlap <= 0) break;
      const fromX = other.x ?? 0;
      const fromY = other.y ?? 0;
      pushApart(hit, other, nodeSize, 0);
      if (domains.every((domain) => overlaps(domain, other) <= 0)) break;
      const dx = fromX - (hit.x ?? 0);
      const dy = fromY - (hit.y ?? 0);
      const length = Math.hypot(dx, dy) || 1;
      other.x = fromX + (-dy / length) * overlap;
      other.y = fromY + (dx / length) * overlap;
    }
  }
}

// CONTAINMENT: run after each layout step. Puts a dot that drifted out of its home back on the home's
// edge, and a dot far outside it (a fresh start, or a home that moved) somewhere inside it. Dragged
// dots stay where the pointer holds them.
export function createContainment(
  nodes: readonly SimNode[],
  nodeSize: number,
  mode: ClusterMode = "domain",
  links: readonly {
    source: LinkEnd<SimNode>;
    target: LinkEnd<SimNode>;
  }[] = NO_LINKS,
): () => void {
  const { homes, circles } = packDomains(nodes, nodeSize, mode, links);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const connected = new Map<string, SimNode[]>();
  const endOf = (end: LinkEnd<SimNode>) =>
    typeof end === "object" ? end : byId.get(String(end));
  for (const link of links) {
    const source = endOf(link.source);
    const target = endOf(link.target);
    if (!source || !target) continue;
    if (centersGrouping(source, mode) && !centersGrouping(target, mode)) {
      const list = connected.get(source.id) ?? [];
      list.push(target);
      connected.set(source.id, list);
    }
    if (centersGrouping(target, mode) && !centersGrouping(source, mode)) {
      const list = connected.get(target.id) ?? [];
      list.push(source);
      connected.set(target.id, list);
    }
  }
  const pin = new Map<string, { x: number; y: number }>();
  // Only a grouping some node type centers places and pins its hubs
  const centers = NODE_TYPE_LIST.some((type) => type.centers === mode);
  const placeInCircle = (node: SimNode, i: number) => {
    const home = homes.get(node.id);
    // A hub that centers this grouping is pinned at its circle center. Other hubs
    // stay inside the circle they were filed in, the same as any other dot.
    if (!home || node.fx != null || node.fy != null) return;
    if (centersGrouping(node, mode)) return;
    const room = Math.max(0, home.r - nodeRadius(node, nodeSize));
    const dx = (node.x ?? 0) - home.x,
      dy = (node.y ?? 0) - home.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= room) return;
    if (distance > home.r * 2) {
      const angle = i * GOLDEN_ANGLE,
        reach = room * 0.8 * Math.sqrt((i * 0.618034) % 1 || 0.5);
      node.x = home.x + Math.cos(angle) * reach;
      node.y = home.y + Math.sin(angle) * reach;
    } else {
      node.x = home.x + (dx / distance) * room;
      node.y = home.y + (dy / distance) * room;
    }
    node.vx = 0;
    node.vy = 0;
  };
  return () => {
    nodes.forEach(placeInCircle);
    // Place each centered node once. Repeating it every frame fights the solver: the node jumps
    // back to the centroid, notes get shoved out of it, and the next frame pulls them in again.
    if (centers && pin.size === 0) {
      for (const node of nodes) {
        const home = homes.get(node.id);
        if (!home?.pin || node.fx != null || node.fy != null) continue;
        const path = clusterKey(node, mode) ?? "";
        let weight = 0;
        let x = 0;
        let y = 0;
        for (const other of nodes) {
          if (hasHubBody(other) || centersGrouping(other, mode)) continue;
          const own = clusterKey(other, mode) ?? "";
          if (own !== path) continue;
          weight += 1;
          x += other.x ?? 0;
          y += other.y ?? 0;
        }
        if (weight === 0) {
          for (const child of circles) {
            if (child.parent !== path) continue;
            weight += 1;
            x += child.x;
            y += child.y;
          }
        }
        for (const other of connected.get(node.id) ?? []) {
          if (GROUPINGS[mode].holds(other, path)) continue;
          weight += OUTSIDE_DOMAIN_PULL;
          x += (other.x ?? 0) * OUTSIDE_DOMAIN_PULL;
          y += (other.y ?? 0) * OUTSIDE_DOMAIN_PULL;
        }
        if (weight > 0) {
          node.x = x / weight;
          node.y = y / weight;
        } else {
          node.x = home.x;
          node.y = home.y;
        }
        node.vx = 0;
        node.vy = 0;
      }
      separateOverlaps(nodes, nodeSize, mode);
      for (const node of nodes) {
        if (!centersGrouping(node, mode) || !homes.get(node.id)?.pin) continue;
        if (node.fx != null || node.fy != null) continue;
        pin.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 });
      }
      fitCirclesAroundCenters(circles, nodes, nodeSize, mode);
    }
    for (const node of nodes) {
      const held = pin.get(node.id);
      if (!held) continue;
      if (node.fx != null && (node.fx !== held.x || node.fy !== held.y))
        continue;
      node.x = held.x;
      node.y = held.y;
      node.fx = held.x;
      node.fy = held.y;
      node.vx = 0;
      node.vy = 0;
    }
  };
}

// Edge points of every ring, so a fitted camera keeps whole circles (and the name above each) in view
export function circleExtents(
  circles: readonly ClusterCircle[],
  labelRoom: number,
): { x: number; y: number }[] {
  return circles.flatMap((circle) => [
    { x: circle.x - circle.r, y: circle.y },
    { x: circle.x + circle.r, y: circle.y },
    { x: circle.x, y: circle.y - circle.r - labelRoom },
    { x: circle.x, y: circle.y + circle.r },
  ]);
}
