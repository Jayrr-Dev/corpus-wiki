import { keepNodes } from "./filters";
import type { GraphData } from "./types";

// =====================================================================
// NEIGHBORHOOD (the local graph): the center node and everything within
// `depth` links of it, following links in either direction.
// =====================================================================

// Maps each node id to the ids it shares a link with
function adjacency(data: GraphData): Map<string, string[]> {
  const neighbors = new Map<string, string[]>();
  const add = (from: string, to: string) => neighbors.set(from, [...(neighbors.get(from) ?? []), to]);
  for (const link of data.links) {
    add(link.source, link.target);
    add(link.target, link.source);
  }
  return neighbors;
}

// Breadth-first walk out from the center, one ring per depth step
export function neighborhood(data: GraphData, centerId: string, depth: number): GraphData {
  const neighbors = adjacency(data);
  const reached = new Set([centerId]);
  let ring = [centerId];
  for (let step = 0; step < depth && ring.length > 0; step += 1) {
    ring = ring.flatMap((id) => neighbors.get(id) ?? []).filter((id) => !reached.has(id));
    ring.forEach((id) => reached.add(id));
  }
  return keepNodes(data, (node) => reached.has(node.id));
}
