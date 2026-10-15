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
import type { GraphForces } from "./settings";
import type { GraphData, GraphLink, GraphNode } from "./types";

// =====================================================================
// PHYSICS: Obsidian's four force sliders mapped onto d3-force.
//   Center force  -> forceX/forceY pull toward (0, 0)
//   Repel force   -> forceManyBody (negative charge)
//   Link force    -> forceLink strength
//   Link distance -> forceLink distance
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
// Derived "similar" links pull this much as hard as stored ones, so real relationships shape the layout
const SIMILAR_PULL = 0.5;

// Dot radius in world units: grows with the square root of link count, like Obsidian
export function nodeRadius(node: Pick<GraphNode, "degree">, nodeSize: number): number {
  return nodeSize * (3 + 1.5 * Math.sqrt(node.degree));
}

// Applies slider values to a simulation's forces (no restart; the caller decides)
export function applyForces(simulation: GraphSimulation, forces: GraphForces, nodeSize: number): void {
  simulation
    .force("x", forceX<SimNode>(0).strength(forces.center * CENTER_SCALE))
    .force("y", forceY<SimNode>(0).strength(forces.center * CENTER_SCALE))
    .force("charge", forceManyBody<SimNode>().strength(-forces.repel * REPEL_SCALE).distanceMax(REPEL_REACH))
    .force("collide", forceCollide<SimNode>((node) => nodeRadius(node, nodeSize) + 2));
  const link = simulation.force<ReturnType<typeof forceLink<SimNode, SimLink>>>("link");
  const strength = forces.link * LINK_SCALE;
  link?.strength((candidate) => (candidate.kind === "similar" ? strength * SIMILAR_PULL : strength)).distance(forces.linkDistance);
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
