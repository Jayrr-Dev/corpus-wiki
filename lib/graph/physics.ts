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
import { deepestPaths, forceClusters, forceRootSeparation } from "./clusters";
import type { GraphForces } from "./settings";
import type { GraphData, GraphLink, GraphNode } from "./types";

// =====================================================================
// PHYSICS: Obsidian's four force sliders mapped onto d3-force.
//   Center force  -> forceX/forceY pull toward (0, 0), weighted by link count
//   Repel force   -> forceManyBody (negative charge), stronger for hubs
//   Link force    -> forceLink strength
//   Link distance -> forceLink distance
//   Domain pull   -> forceClusters (dots gather by domain and subdomain)
// A collide force keeps dots from overlapping. The simulation stops by
// itself once the layout settles (d3's alpha decay), so an idle graph
// uses no CPU.
// =====================================================================

// SIMULATION SHAPES: graph nodes and links with d3's position fields
export type SimNode = GraphNode & SimulationNodeDatum;
export type SimLink = Omit<GraphLink, "source" | "target"> & SimulationLinkDatum<SimNode>;
export type GraphSimulation = Simulation<SimNode, SimLink>;

// SCALES: slider units -> d3 units (tuned by eye for a few hundred to a few thousand dots)
const CENTER_SCALE = 0.1;
const REPEL_SCALE = 15;
const LINK_SCALE = 0.5;
const REPEL_REACH = 800;
const CLUSTER_SCALE = 1;
// At full domain pull, links between groups keep this little of their strength (1 - CROSS_SLACK)
const CROSS_SLACK = 0.9;
// Derived "similar" links pull this much as hard as stored ones, so real relationships shape the layout
const SIMILAR_PULL = 0.5;

// Orphans keep this much of the center and domain pull, so they drift out without flying off
const ORPHAN_PULL = 0.15;
// Link count at which a dot gets half of the pull it can gain from links
const HALF_PULL_DEGREE = 3;
// Each sqrt(link) adds this much repulsion, so hubs clear room around their neighbors
const HUB_REPEL = 0.5;

// Dot radius in world units: emphasize connected hubs while keeping growth sublinear.
export function nodeRadius(node: Pick<GraphNode, "degree">, nodeSize: number): number {
  if (node.degree === 1) return nodeSize * 2;
  // Keep lightly connected satellites small without reducing established hubs.
  const connectionScale = Math.min(1, node.degree / 6);
  return nodeSize * (3 + 4 * Math.pow(node.degree, 0.65) * connectionScale);
}

// Share of the center and domain pull a dot feels: weak for orphans, near full for hubs
export function pullWeight(node: Pick<GraphNode, "degree">): number {
  return ORPHAN_PULL + (1 - ORPHAN_PULL) * (node.degree / (node.degree + HALF_PULL_DEGREE));
}

// Applies slider values to a simulation's forces (no restart; the caller decides)
export function applyForces(simulation: GraphSimulation, forces: GraphForces, nodeSize: number): void {
  simulation
    .force("x", forceX<SimNode>(0).strength((node) => forces.center * CENTER_SCALE * pullWeight(node)))
    .force("y", forceY<SimNode>(0).strength((node) => forces.center * CENTER_SCALE * pullWeight(node)))
    .force("charge", forceManyBody<SimNode>().strength((node) => -forces.repel * REPEL_SCALE * (1 + HUB_REPEL * Math.sqrt(node.degree))).distanceMax(REPEL_REACH))
    .force("collide", forceCollide<SimNode>((node) => nodeRadius(node, nodeSize) + 2))
    .force("cluster", forceClusters(forces.cluster * CLUSTER_SCALE))
    .force("root-separation", forces.cluster > 0 ? forceRootSeparation(nodeSize, simulation.force<ReturnType<typeof forceLink<SimNode, SimLink>>>("link")?.links() ?? []) : null);
  const link = simulation.force<ReturnType<typeof forceLink<SimNode, SimLink>>>("link");
  const strength = forces.link * LINK_SCALE;
  // Links between different domain groups slacken as the domain pull rises, so groups can sit apart
  const paths = deepestPaths(simulation.nodes());
  const crossing = (candidate: SimLink) => {
    const [from, to] = [candidate.source, candidate.target].map((end) => (typeof end === "object" ? paths.get(end) : undefined));
    return from !== undefined && to !== undefined && from !== to;
  };
  link
    ?.strength((candidate) => {
      const base = candidate.kind === "similar" ? strength * SIMILAR_PULL : strength;
      return crossing(candidate) ? base * (1 - Math.min(1, forces.cluster) * CROSS_SLACK) : base;
    })
    .distance(forces.linkDistance);
}

// How far from a placed neighbor a new dot starts
const NEW_DOT_SPREAD = 20;

// Start point for a new dot: beside a neighbor that is already placed, so the replay grows outward
function startNear(node: GraphNode, data: GraphData, previous: ReadonlyMap<string, SimNode>): Partial<SimNode> {
  const link = data.links.find((candidate) => (candidate.source === node.id && previous.has(candidate.target)) || (candidate.target === node.id && previous.has(candidate.source)));
  const anchor = link ? previous.get(link.source === node.id ? link.target : link.source) : undefined;
  if (anchor?.x === undefined || anchor.y === undefined) return {};
  const angle = Math.random() * Math.PI * 2;
  return { x: anchor.x + Math.cos(angle) * NEW_DOT_SPREAD, y: anchor.y + Math.sin(angle) * NEW_DOT_SPREAD };
}

// Copies the graph into simulation objects, keeping the positions of dots already placed
export function toSimGraph(data: GraphData, previous: ReadonlyMap<string, SimNode>): { nodes: SimNode[]; links: SimLink[] } {
  const nodes = data.nodes.map((node) => {
    const placed = previous.get(node.id);
    if (placed) return { ...node, x: placed.x, y: placed.y, vx: placed.vx, vy: placed.vy };
    return previous.size > 0 ? { ...node, ...startNear(node, data, previous) } : { ...node };
  });
  const links = data.links.map((link) => ({ ...link }));
  return { nodes, links };
}

// Creates a stopped simulation over these nodes and links (the caller restarts it)
export function createSimulation(nodes: SimNode[], links: SimLink[], forces: GraphForces, nodeSize: number): GraphSimulation {
  const simulation = forceSimulation<SimNode, SimLink>(nodes)
    .force("link", forceLink<SimNode, SimLink>(links).id((node) => node.id))
    .stop();
  applyForces(simulation, forces, nodeSize);
  return simulation;
}
