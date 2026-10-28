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
import type { GraphForces } from "./settings";
import type { GraphData, GraphLink, GraphNode } from "./types";

// =====================================================================
// PHYSICS: Obsidian's four force sliders mapped onto d3-force.
//   Center force  -> pull toward (0, 0), stronger for hubs so big dots clump inward
//                    and thin ones drift outer
//   Repel force   -> forceManyBody (negative charge), stronger for hubs
//   Link force    -> forceLink strength
//   Link distance -> forceLink distance
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

// Dot radius in world units: emphasize connected hubs while keeping growth sublinear.
export function nodeRadius(
  node: Pick<GraphNode, "degree">,
  nodeSize: number,
): number {
  if (node.degree === 1) return nodeSize * 2;
  // Keep lightly connected satellites small without reducing established hubs.
  const connectionScale = Math.min(1, node.degree / 6);
  return nodeSize * (3 + 4 * Math.pow(node.degree, 0.65) * connectionScale);
}

// Share of pull a dot feels: weak for orphans, near full for hubs
export function pullWeight(node: Pick<GraphNode, "degree">): number {
  return (
    ORPHAN_PULL +
    (1 - ORPHAN_PULL) * (node.degree / (node.degree + HALF_PULL_DEGREE))
  );
}

function centerPullWeight(node: Pick<GraphNode, "degree">): number {
  return Math.pow(pullWeight(node), CENTER_PULL_POWER);
}

// Applies slider values to a simulation's forces (no restart; the caller decides)
export function applyForces(
  simulation: GraphSimulation,
  forces: GraphForces,
  nodeSize: number,
  mode: ClusterMode = "domain",
): void {
  // Groups on: every dot has a home circle in the packing
  const homes =
    forces.cluster > 0
      ? packDomains(simulation.nodes(), nodeSize, mode).homes
      : null;
  const towardCenter = (node: SimNode) =>
    forces.center * CENTER_SCALE * centerPullWeight(node);
  const towardHome = (node: SimNode) =>
    homes ? forces.cluster * HOME_SCALE * pullWeight(node) : 0;
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
        .strength(
          (node) =>
            -forces.repel *
            REPEL_SCALE *
            (1 + HUB_REPEL * Math.sqrt(node.degree)),
        )
        .distanceMax(homes ? PACKED_REPEL_REACH : REPEL_REACH),
    )
    // Collide runs last and at full strength: it sees every other pull first, so big hubs
    // drawn into one domain spot still end up side by side. Re-adding it keeps it last.
    .force("collide", null)
    .force(
      "collide",
      forceCollide<SimNode>((node) => nodeRadius(node, nodeSize) + 2)
        .strength(1)
        .iterations(COLLIDE_PASSES),
    );
  const link =
    simulation.force<ReturnType<typeof forceLink<SimNode, SimLink>>>("link");
  const strength = forces.link * LINK_SCALE;
  // With domains on, links between two homes do not pull: each dot stays in its own circle anyway
  const crossing = (candidate: SimLink) => {
    const [from, to] = [candidate.source, candidate.target].map((end) =>
      typeof end === "object" ? homes?.get(end.id) : undefined,
    );
    return from !== undefined && to !== undefined && from !== to;
  };
  link
    ?.strength((candidate) => {
      if (crossing(candidate)) return 0;
      return candidate.kind === "similar" ? strength * SIMILAR_PULL : strength;
    })
    .distance(forces.linkDistance);
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
): GraphSimulation {
  const simulation = forceSimulation<SimNode, SimLink>(nodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(links).id((node) => node.id),
    )
    .stop();
  applyForces(simulation, forces, nodeSize, mode);
  return simulation;
}
