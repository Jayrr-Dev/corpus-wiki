"use client";

import type { GraphData, GraphForces } from "@/lib/graph";
import { type ClusterMode, createContainment } from "@/lib/graph/clusters";
import {
  applyForces,
  createSimulation,
  type GraphSimulation,
  type NodeColorOf,
  type SimLink,
  type SimNode,
  toSimGraph,
} from "@/lib/graph/physics";
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

// =====================================================================
// FORCE LAYOUT: runs the d3 simulation for the visible graph. A new
// graph (a filter, the replay) keeps the dots already placed, so the
// layout grows instead of jumping. Slider changes re-heat the layout
// without rebuilding it.
// =====================================================================

export interface ForceLayout {
  revision: number;
  nodes: SimNode[];
  links: SimLink[];
  simulation: GraphSimulation | null;
}

// HEAT: a full start for the first layout, a nudge after that
const FIRST_ALPHA = 1;
const NUDGE_ALPHA = 0.3;

// Runs the simulation and returns it as a ref; calls `onTick.current` each step so the canvas can redraw
export function useForceLayout(
  graph: GraphData,
  forces: GraphForces,
  nodeSize: number,
  onTick: RefObject<() => void>,
  mode: ClusterMode = "domain",
  colorOf: NodeColorOf = () => null,
): RefObject<ForceLayout> {
  const layout = useRef<ForceLayout>({
    nodes: [],
    links: [],
    simulation: null,
    revision: 0,
  });
  const settings = useRef({ forces, nodeSize, mode, colorOf });
  // Latest slider values for the rebuild below (synced after render, read in effects)
  useLayoutEffect(() => {
    settings.current = { forces, nodeSize, mode, colorOf };
  }, [forces, nodeSize, mode, colorOf]);

  // REBUILD on a new visible graph, carrying positions over
  useEffect(() => {
    const previous = new Map(
      layout.current.nodes.map((node) => [node.id, node]),
    );
    const { nodes, links } = toSimGraph(graph, previous);
    const simulation = createSimulation(
      nodes,
      links,
      settings.current.forces,
      settings.current.nodeSize,
      settings.current.mode,
      settings.current.colorOf,
    );
    let containedSize = settings.current.nodeSize;
    let containedMode = settings.current.mode;
    let contain = createContainment(nodes, containedSize, containedMode, links);
    const keepInside = () => {
      if (settings.current.forces.cluster <= 0) return;
      if (
        containedSize !== settings.current.nodeSize ||
        containedMode !== settings.current.mode
      ) {
        containedSize = settings.current.nodeSize;
        containedMode = settings.current.mode;
        contain = createContainment(nodes, containedSize, containedMode, links);
      }
      contain();
    };
    // Dots start inside their circles, so the first frame already shows the packed domains
    keepInside();
    simulation.on("tick", () => {
      // d3 moves the dots after its forces run; put any that left their circle back after that
      // movement, so the drawn (and final) frame keeps every dot inside its own domain
      keepInside();
      layout.current.revision++;
      onTick.current();
    });
    simulation.alpha(previous.size === 0 ? FIRST_ALPHA : NUDGE_ALPHA).restart();
    layout.current = {
      nodes,
      links,
      simulation,
      revision: layout.current.revision + 1,
    };
    onTick.current();
    return () => void simulation.stop();
  }, [graph, mode, onTick]);

  // RE-HEAT on a force or size change (skipped when the rebuild above already used these values)
  const applied = useRef<{
    forces: GraphForces;
    nodeSize: number;
    mode: ClusterMode;
    colorOf: NodeColorOf;
  } | null>(null);
  useEffect(() => {
    const { simulation } = layout.current;
    const isFirstApply = applied.current === null;
    applied.current = { forces, nodeSize, mode, colorOf };
    if (!simulation || isFirstApply) return;
    applyForces(simulation, forces, nodeSize, mode, colorOf);
    simulation.alpha(NUDGE_ALPHA).restart();
  }, [forces, nodeSize, mode, colorOf]);

  return layout;
}
