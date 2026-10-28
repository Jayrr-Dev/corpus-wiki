import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { packDomains, type ClusterMode } from "./clusters";
import { hasHubBody } from "./nodeTypes";
import type { GraphForces } from "./settings";
import type { GraphData, GraphLink, GraphNode } from "./types";

// =====================================================================
// PHYSICS: Obsidian's four force sliders mapped onto d3-force.
//   Center force  -> pull toward (0, 0), stronger for hubs so big dots clump inward
//                    and thin ones drift outer
//   Repel force   -> forceManyBody (negative charge), stronger for hubs
//   Link force    -> a high-degree dot pulls harder, and the lighter end moves.
//                    A link that is already stretched past its target distance
//                    pulls less the farther it reaches.
//   Link distance -> just outside the two dots for a hub, nearer the slider for a weak link
//   Neighborhood  -> a hub pulls same-colored neighbors into one clump, and pushes
//                    dots it does not link away from that clump
//   Domain pull   -> above 0, domains on: circles are packed up front (clusters.ts), each dot
//                    is pulled to its own circle and kept inside it (createContainment), and
//                    links between domains stop pulling (bundles show them instead)
// A collide force keeps dots from overlapping. The simulation stops by
// itself once the layout settles (d3's alpha decay), so an idle graph
// uses no CPU.
// =====================================================================

// SIMULATION SHAPES: graph nodes and links with d3's position fields
export type SimNode = GraphNode & SimulationNodeDatum;
export type SimLink = Omit<GraphLink, "source" | "target"> &
  SimulationLinkDatum<SimNode>;
export type GraphSimulation = Simulation<SimNode, SimLink>;

// SCALES: slider units -> d3 units (tuned by eye for a few hundred to a few thousand dots)
const CENTER_SCALE = 0.16;
const REPEL_SCALE = 15;
const LINK_SCALE = 0.5;
const REPEL_REACH = 800;
// With domains on, how much the domain pull adds to each dot's pull toward its circle's middle
const HOME_SCALE = 0.1;
// With domains on, dots only push dots this close (in world units): a dot in another circle is kept
// out by containment, so pushing across circles only crowds dots against their rings
const PACKED_REPEL_REACH = 150;
// Derived "similar" links pull this much as hard as stored ones, so real relationships shape the layout
const SIMILAR_PULL = 0.5;

// Thin dots keep this much of the pull; hubs take nearly all of it
const ORPHAN_PULL = 0.04;
// Link count at which a dot gets half of the pull it can gain from links
const HALF_PULL_DEGREE = 8;
// Center pull is raised by this power so hubs clump inward harder than the linear home pull
const CENTER_PULL_POWER = 1.6;
// Each sqrt(link) adds this much repulsion, so hubs clear room around their neighbors
const HUB_REPEL = 0.5;
// Collision passes per tick; one pass leaves big dots overlapping when many pulls meet
const COLLIDE_PASSES = 3;
// A dot with at least this many links gathers its neighbors and pushes strangers out
const HUB_DEGREE = 6;
// How hard a hub pulls one color of neighbor toward that color's middle
const COLOR_PULL = 0.16;
const SIMILAR_COLOR_PULL = 0.05;
// How hard a stranger is pushed out of a hub's neighborhood, per tick at alpha 1
const STRANGER_PUSH = 0.85;

// Dot radius in world units: emphasize connected hubs while keeping growth sublinear.
export function nodeRadius(
  node: Pick<GraphNode, "degree" | "kind">,
  nodeSize: number,
): number {
  // Domain hubs sit in the middle of a topic circle and grow with how many notes link in.
  // Two thirds of that size: one third smaller than the full hub.
  if (hasHubBody(node))
    return (
      nodeSize * (8 + 5 * Math.sqrt(Math.max(0, node.degree))) * (2 / 3)
    );
  if (node.degree === 1) return nodeSize * 2;
  // Keep lightly connected satellites small without reducing established hubs.
  const connectionScale = Math.min(1, node.degree / 6);
  return nodeSize * (3 + 4 * Math.pow(node.degree, 0.65) * connectionScale);
}

// Share of pull a dot feels: weak for orphans, near full for hubs (domain hubs stay neutral)
export function pullWeight(node: Pick<GraphNode, "degree" | "kind">): number {
  if (hasHubBody(node)) return 1;
  return (
    ORPHAN_PULL +
    (1 - ORPHAN_PULL) * (node.degree / (node.degree + HALF_PULL_DEGREE))
  );
}

function centerPullWeight(node: Pick<GraphNode, "degree" | "kind">): number {
  if (hasHubBody(node)) return ORPHAN_PULL;
  return Math.pow(pullWeight(node), CENTER_PULL_POWER);
}

function repelStrength(node: Pick<GraphNode, "degree" | "kind">): number {
  if (hasHubBody(node)) return 1;
  return 1 + HUB_REPEL * Math.sqrt(node.degree);
}

// Group color of a dot, used to clump a hub's neighbors. Null means no group color.
export type NodeColorOf = (node: SimNode) => string | null;

function linkNodes(link: SimLink): [SimNode, SimNode] | null {
  const { source, target } = link;
  if (typeof source !== "object" || typeof target !== "object") return null;
  return [source, target];
}

// Share of pull on the heavier end. Hubs gather; sparse links stay near the slider.
function gatherWeight(link: SimLink): number {
  const pair = linkNodes(link);
  if (!pair) return 0;
  return Math.max(pullWeight(pair[0]), pullWeight(pair[1]));
}

// Neighbors of a hub sit just outside it. A weak or derived link keeps more of the slider gap.
function gatherDistance(
  link: SimLink,
  slider: number,
  nodeSize: number,
): number {
  const pair = linkNodes(link);
  if (!pair) return slider;
  const touch =
    nodeRadius(pair[0], nodeSize) + nodeRadius(pair[1], nodeSize) + 4;
  const hub = gatherWeight(link);
  const looseness = link.kind === "similar" ? 0.62 : 0.18;
  const gap = Math.max(
    4,
    slider * (looseness + (1 - looseness) * (1 - hub) * 0.45),
  );
  return touch + gap;
}

// Full effect at or inside the target distance, then less as the link stretches.
function linkFalloff(distance: number, reach: number): number {
  const past = Math.max(0, distance / Math.max(reach, 1) - 1);
  return 1 / (1 + past * past);
}

interface NeighborhoodForce {
  (alpha: number): void;
  initialize(nodes: SimNode[]): void;
}

// Hubs pull each color of neighbor into its own clump, and push unlinked dots out of that clump.
function neighborhoodForce(
  links: readonly SimLink[],
  nodeSize: number,
  linkDistance: number,
  homes: ReadonlyMap<string, { x: number; y: number }> | null,
  colorOf: NodeColorOf,
): NeighborhoodForce {
  let nodes: SimNode[] = [];
  const byId = new Map<string, SimNode>();
  // neighbor id -> derived "similar" link (a real link wins)
  const neighbors = new Map<string, Map<string, boolean>>();

  const sameHome = (a: SimNode, b: SimNode) => {
    if (!homes) return true;
    const homeA = homes.get(a.id);
    const homeB = homes.get(b.id);
    if (!homeA || !homeB) return true;
    return homeA === homeB;
  };

  const remember = (from: string, to: string, similar: boolean) => {
    let known = neighbors.get(from);
    if (!known) {
      known = new Map();
      neighbors.set(from, known);
    }
    if (known.get(to) === false) return;
    known.set(to, similar);
  };

  const build = () => {
    neighbors.clear();
    for (const link of links) {
      const pair = linkNodes(link);
      if (!pair || pair[0] === pair[1] || !sameHome(pair[0], pair[1])) continue;
      const similar = link.kind === "similar";
      remember(pair[0].id, pair[1].id, similar);
      remember(pair[1].id, pair[0].id, similar);
    }
  };

  const force: NeighborhoodForce = (alpha) => {
    if (nodes.length === 0 || alpha <= 0) return;
    for (const node of nodes) {
      if (hasHubBody(node) || node.degree < HUB_DEGREE) continue;
      const linked = neighbors.get(node.id);
      if (!linked || linked.size < 2) continue;
      const groups = new Map<
        string,
        { x: number; y: number; members: { node: SimNode; similar: boolean }[] }
      >();
      for (const [id, similar] of linked) {
        const other = byId.get(id);
        if (!other || other.fx != null) continue;
        const key = colorOf(other) ?? "";
        let group = groups.get(key);
        if (!group) {
          group = { x: 0, y: 0, members: [] };
          groups.set(key, group);
        }
        group.members.push({ node: other, similar });
        group.x += other.x ?? 0;
        group.y += other.y ?? 0;
      }
      const hubPull = 0.35 + pullWeight(node);
      for (const group of groups.values()) {
        if (group.members.length < 2) continue;
        const cx = group.x / group.members.length;
        const cy = group.y / group.members.length;
        for (const member of group.members) {
          const dx = cx - (member.node.x ?? 0);
          const dy = cy - (member.node.y ?? 0);
          const distance = Math.hypot(dx, dy);
          const pull =
            alpha *
            (member.similar ? SIMILAR_COLOR_PULL : COLOR_PULL) *
            hubPull *
            linkFalloff(distance, linkDistance);
          member.node.vx = (member.node.vx ?? 0) + dx * pull;
          member.node.vy = (member.node.vy ?? 0) + dy * pull;
        }
      }
    }

    let hubCount = 0;
    for (const node of nodes) {
      if (!hasHubBody(node) && node.degree >= HUB_DEGREE) hubCount += 1;
    }
    if (hubCount === 0) return;

    const cell = Math.max(72, linkDistance + nodeSize * 48);
    const grid = new Map<string, SimNode[]>();
    const slot = (x: number, y: number) =>
      `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
    for (const node of nodes) {
      if (hasHubBody(node)) continue;
      const key = slot(node.x ?? 0, node.y ?? 0);
      const bucket = grid.get(key);
      if (bucket) bucket.push(node);
      else grid.set(key, [node]);
    }
    for (const node of nodes) {
      if (hasHubBody(node) || node.degree < HUB_DEGREE || node.fx != null)
        continue;
      const linked = neighbors.get(node.id);
      const reach =
        nodeRadius(node, nodeSize) + Math.max(28, linkDistance) * 0.95;
      const gx = Math.floor((node.x ?? 0) / cell);
      const gy = Math.floor((node.y ?? 0) / cell);
      const span = Math.min(4, Math.ceil(reach / cell));
      for (let ix = gx - span; ix <= gx + span; ix++) {
        for (let iy = gy - span; iy <= gy + span; iy++) {
          const bucket = grid.get(`${ix}:${iy}`);
          if (!bucket) continue;
          for (const other of bucket) {
            if (other === node || hasHubBody(other) || other.fx != null)
              continue;
            if (linked?.has(other.id) || !sameHome(node, other)) continue;
            if (pullWeight(other) > pullWeight(node)) continue;
            const dx = (other.x ?? 0) - (node.x ?? 0);
            const dy = (other.y ?? 0) - (node.y ?? 0);
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq < 1 || distanceSq > reach * reach) continue;
            const distance = Math.sqrt(distanceSq);
            const push =
              alpha *
              STRANGER_PUSH *
              (1 - distance / reach) *
              (1 + Math.sqrt(node.degree));
            other.vx = (other.vx ?? 0) + (dx / distance) * push;
            other.vy = (other.vy ?? 0) + (dy / distance) * push;
          }
        }
      }
    }
  };
  force.initialize = (next) => {
    nodes = next;
    byId.clear();
    for (const node of next) byId.set(node.id, node);
    build();
  };
  return force;
}

// This d3-force build has no link bias. Move the lighter end more, so a hub
// stays put and the dots it links come to it.
function gatherForce(
  links: readonly SimLink[],
  nodeSize: number,
  linkDistance: number,
  linkStrength: number,
  homes: ReadonlyMap<string, { x: number; y: number }> | null,
): NeighborhoodForce {
  const byId = new Map<string, SimNode>();
  const sameHome = (a: SimNode, b: SimNode) => {
    if (!homes) return true;
    const homeA = homes.get(a.id);
    const homeB = homes.get(b.id);
    if (!homeA || !homeB) return true;
    return homeA === homeB;
  };
  const resolve = (end: SimLink["source"]): SimNode | null => {
    if (typeof end === "object") return end;
    return byId.get(String(end)) ?? null;
  };
  const force: NeighborhoodForce = (alpha) => {
    if (alpha <= 0) return;
    for (const link of links) {
      const source = resolve(link.source);
      const target = resolve(link.target);
      if (!source || !target || source === target || !sameHome(source, target))
        continue;
      const dx = (target.x ?? 0) - (source.x ?? 0);
      const dy = (target.y ?? 0) - (source.y ?? 0);
      const distance = Math.hypot(dx, dy);
      if (distance < 1) continue;
      const desired = gatherDistance(
        { ...link, source, target },
        linkDistance,
        nodeSize,
      );
      const sourceWeight = pullWeight(source);
      const targetWeight = pullWeight(target);
      const sum = sourceWeight + targetWeight;
      if (sum <= 0) continue;
      const pull =
        alpha *
        linkStrength *
        (link.kind === "similar" ? SIMILAR_PULL : 1) *
        (0.7 + 1.8 * Math.max(sourceWeight, targetWeight)) *
        linkFalloff(distance, desired);
      const correction = ((distance - desired) / distance) * pull;
      if (source.fx == null) {
        source.vx = (source.vx ?? 0) + dx * correction * (targetWeight / sum);
        source.vy = (source.vy ?? 0) + dy * correction * (targetWeight / sum);
      }
      if (target.fx == null) {
        target.vx = (target.vx ?? 0) - dx * correction * (sourceWeight / sum);
        target.vy = (target.vy ?? 0) - dy * correction * (sourceWeight / sum);
      }
    }
  };
  force.initialize = (next) => {
    byId.clear();
    for (const node of next) byId.set(node.id, node);
  };
  return force;
}

// Applies slider values to a simulation's forces (no restart; the caller decides)
export function applyForces(
  simulation: GraphSimulation,
  forces: GraphForces,
  nodeSize: number,
  mode: ClusterMode = "domain",
  colorOf: NodeColorOf = () => null,
  ordered = false,
): void {
  // Groups on: every dot has a home circle in the packing
  const homes =
    forces.cluster > 0
      ? packDomains(
          simulation.nodes(),
          nodeSize,
          mode,
          simulation
            .force<ReturnType<typeof forceLink<SimNode, SimLink>>>("link")
            ?.links() ?? [],
          ordered,
        ).homes
      : null;
  const linkStrength = forces.link * LINK_SCALE;
  const towardCenter = (node: SimNode) =>
    forces.center * CENTER_SCALE * centerPullWeight(node);
  const towardHome = (node: SimNode) =>
    homes?.has(node.id) ? forces.cluster * HOME_SCALE * pullWeight(node) : 0;
  simulation
    // Drop the old combined x/y forces so a prior layout does not keep pulling to the wrong target
    .force("x", null)
    .force("y", null)
    .force("centerX", forceX<SimNode>(0).strength(towardCenter))
    .force("centerY", forceY<SimNode>(0).strength(towardCenter))
    .force(
      "homeX",
      homes
        ? forceX<SimNode>((node) => homes.get(node.id)?.x ?? 0).strength(
            towardHome,
          )
        : null,
    )
    .force(
      "homeY",
      homes
        ? forceY<SimNode>((node) => homes.get(node.id)?.y ?? 0).strength(
            towardHome,
          )
        : null,
    )
    .force(
      "charge",
      forceManyBody<SimNode>()
        .strength((node) => -forces.repel * REPEL_SCALE * repelStrength(node))
        .distanceMax(homes ? PACKED_REPEL_REACH : REPEL_REACH),
    )
    // Collide runs last and at full strength: it sees every other pull first, so big hubs
    // drawn into one domain spot still end up side by side. Re-adding it keeps it last.
    .force(
      "neighborhood",
      neighborhoodForce(
        simulation
          .force<ReturnType<typeof forceLink<SimNode, SimLink>>>("link")
          ?.links() ?? [],
        nodeSize,
        forces.linkDistance,
        homes,
        colorOf,
      ),
    )
    .force(
      "gather",
      gatherForce(
        simulation
          .force<ReturnType<typeof forceLink<SimNode, SimLink>>>("link")
          ?.links() ?? [],
        nodeSize,
        forces.linkDistance,
        linkStrength,
        homes,
      ),
    )
    .force("collide", null)
    .force(
      "collide",
      forceCollide<SimNode>((node) => nodeRadius(node, nodeSize) + 2)
        .strength(1)
        .iterations(COLLIDE_PASSES),
    );
  // The built-in link force grows with stretch. Gather owns the pull so a
  // long link fades instead of dragging a dot across the circle. Distance is
  // still recorded here for anything that reads the force.
  simulation
    .force<ReturnType<typeof forceLink<SimNode, SimLink>>>("link")
    ?.strength(0)
    .distance((candidate) =>
      gatherDistance(candidate, forces.linkDistance, nodeSize),
    );
}

// How far from a placed neighbor a new dot starts
const NEW_DOT_SPREAD = 20;

// Start point for a new dot: beside a neighbor that is already placed, so the replay grows outward
function startNear(
  node: GraphNode,
  data: GraphData,
  previous: ReadonlyMap<string, SimNode>,
): Partial<SimNode> {
  const link = data.links.find(
    (candidate) =>
      (candidate.source === node.id && previous.has(candidate.target)) ||
      (candidate.target === node.id && previous.has(candidate.source)),
  );
  const anchor = link
    ? previous.get(link.source === node.id ? link.target : link.source)
    : undefined;
  if (anchor?.x === undefined || anchor.y === undefined) return {};
  const angle = Math.random() * Math.PI * 2;
  return {
    x: anchor.x + Math.cos(angle) * NEW_DOT_SPREAD,
    y: anchor.y + Math.sin(angle) * NEW_DOT_SPREAD,
  };
}

// Copies the graph into simulation objects, keeping the positions of dots already placed
export function toSimGraph(
  data: GraphData,
  previous: ReadonlyMap<string, SimNode>,
): { nodes: SimNode[]; links: SimLink[] } {
  const nodes = data.nodes.map((node) => {
    const placed = previous.get(node.id);
    if (placed)
      return {
        ...node,
        x: placed.x,
        y: placed.y,
        vx: placed.vx,
        vy: placed.vy,
      };
    return previous.size > 0
      ? { ...node, ...startNear(node, data, previous) }
      : { ...node };
  });
  const links = data.links.map((link) => ({ ...link }));
  return { nodes, links };
}

// Creates a stopped simulation over these nodes and links (the caller restarts it)
export function createSimulation(
  nodes: SimNode[],
  links: SimLink[],
  forces: GraphForces,
  nodeSize: number,
  mode: ClusterMode = "domain",
  colorOf: NodeColorOf = () => null,
  ordered = false,
): GraphSimulation {
  const simulation = forceSimulation<SimNode, SimLink>(nodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(links).id((node) => node.id),
    )
    .stop();
  applyForces(simulation, forces, nodeSize, mode, colorOf, ordered);
  return simulation;
}
