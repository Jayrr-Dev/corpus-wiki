"use client";
/* eslint-disable shadcn/no-inline-styles -- stage frames compute every position, scale and opacity from t */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { drawGraph, groupingOf } from "@/components/graph/drawGraph";
import { GROUP_COLORS } from "@/components/graph/groupColors";
import { readCanvasPalette } from "@/components/graph/palette";
import { GraphPanel } from "@/components/graph/panel/GraphPanel";
import { Camera, easeOut, lerp, seg, StageProviders, StageShell, type Scene } from "@/components/video-stage";
import {
  applyFilters,
  buildGraph,
  circleExtents,
  clusterCircles,
  DEFAULT_GRAPH_SETTINGS,
  graphForGrouping,
  inDomain,
  inDomainScope,
  withRelated,
  type GraphSettings,
} from "@/lib/graph";
import { fitCamera } from "@/lib/graph/camera";
import { createContainment } from "@/lib/graph/clusters";
import { createSimulation, toSimGraph, type SimLink, type SimNode } from "@/lib/graph/physics";
import { withDomainColorGroups } from "@/lib/graph/settings";
import { GRAPH_ROWS } from "@/lib/video-stage/phoenix/connect";

// GRAPH: the Graph screen with its real settings panel. Dots fly out from the middle into
// their domain circles, links follow, the counts tick up, and the camera pushes in. 3 seconds.
// The real GraphCanvas runs d3 on its own clock, so this scene settles the same layout once
// (same simulation, same containment) and draws each frame with the app's own drawGraph.

const DURATION = 3;
// Room above a ring for its label (GraphCanvas uses the same)
const CIRCLE_LABEL_ROOM = 26;
// The graph fits above the bottom band of the frame, where captions go
const CAPTION_BAND = 200;
// Ticks the layout gets before the first frame (d3's default cooling takes about 300)
const SETTLE_TICKS = 300;
// Each dot's flight: when the first and last start, and how long one takes
const FIRST_START = -0.35;
const LAST_START = 1.7;
const FLIGHT = 0.55;

const DATA = buildGraph(GRAPH_ROWS);

// The panel as it opens on this space, with people and systems shown beside the claims
const SETTINGS: GraphSettings = withDomainColorGroups({
  ...DEFAULT_GRAPH_SETTINGS,
  filters: { ...DEFAULT_GRAPH_SETTINGS.filters, shown: { ...DEFAULT_GRAPH_SETTINGS.filters.shown, entity: true, stakeholder: true } },
}, DATA.nodes);

// THE VISIBLE GRAPH, the same pipeline GraphView runs: related links, filters, grouping
function visibleGraph(settings: GraphSettings) {
  const related = withRelated(DATA, { show: settings.filters.showRelated, threshold: settings.filters.relatedness });
  const filtered = applyFilters(related, settings.filters);
  const evidence = inDomain(inDomainScope(related, settings.filters.domainScope), settings.filters.domain);
  return graphForGrouping(filtered, settings.display.groupBy, evidence);
}

// THE SETTLED LAYOUT: useForceLayout's simulation and containment, run to rest in one go
function settle(settings: GraphSettings) {
  const graph = visibleGraph(settings);
  const mode = groupingOf(settings.display.groupBy);
  const colorOf = GROUP_COLORS[mode](settings.groups);
  const { nodeSize, ordered } = settings.display;
  const { nodes, links } = toSimGraph(graph, new Map());
  const simulation = createSimulation(nodes, links, settings.forces, nodeSize, mode, colorOf, ordered);
  const contain = createContainment(nodes, nodeSize, mode, links, ordered);
  contain();
  for (let i = 0; i < SETTLE_TICKS; i++) {
    simulation.tick();
    contain();
  }
  simulation.stop();
  // Dots leave the middle first, the rim last
  const cx = nodes.reduce((sum, node) => sum + (node.x ?? 0), 0) / Math.max(1, nodes.length);
  const cy = nodes.reduce((sum, node) => sum + (node.y ?? 0), 0) / Math.max(1, nodes.length);
  const distance = (node: SimNode) => Math.hypot((node.x ?? 0) - cx, (node.y ?? 0) - cy);
  const order = [...nodes].sort((a, b) => distance(a) - distance(b) || a.id.localeCompare(b.id));
  const startAt = new Map(order.map((node, rank) => [node.id, lerp(FIRST_START, LAST_START, rank / Math.max(1, order.length - 1))]));
  // Each circle opens with the first dot that lands in it (the packing stays put, so rings never jump)
  const circles = clusterCircles(nodes, nodeSize, mode, links, ordered).map((circle) => {
    const inside = nodes.filter((node) => Math.hypot((node.x ?? 0) - circle.x, (node.y ?? 0) - circle.y) <= circle.r);
    return { circle, opensAt: Math.min(LAST_START, ...inside.map((node) => startAt.get(node.id)!)) };
  });
  return { nodes, links, mode, colorOf, startAt, centre: { x: cx, y: cy }, circles };
}

const endId = (end: SimLink["source"]) => (typeof end === "object" ? end.id : String(end));

// THE GRAPH AT t: the dots that have started, partway along their flight out from the middle
function grownAt(layout: ReturnType<typeof settle>, t: number) {
  const { centre } = layout;
  const shown = new Map<string, SimNode>();
  for (const node of layout.nodes) {
    const p = easeOut(seg(t, layout.startAt.get(node.id)!, layout.startAt.get(node.id)! + FLIGHT));
    if (p <= 0) continue;
    const reach = lerp(0.3, 1, p);
    shown.set(node.id, { ...node, x: centre.x + ((node.x ?? 0) - centre.x) * reach, y: centre.y + ((node.y ?? 0) - centre.y) * reach });
  }
  const links: SimLink[] = [];
  for (const link of layout.links) {
    const source = shown.get(endId(link.source));
    const target = shown.get(endId(link.target));
    if (source && target) links.push({ ...link, source, target });
  }
  // Rings grow out to their final size around their own centres
  const circles = layout.circles.flatMap(({ circle, opensAt }) => {
    const p = easeOut(seg(t, opensAt, opensAt + FLIGHT + 0.2));
    return p > 0 ? [{ ...circle, r: circle.r * lerp(0.25, 1, p) }] : [];
  });
  return { nodes: [...shown.values()], links, circles };
}

function StageGraph({ t }: { t: number }) {
  const [settings, setSettings] = useState(SETTINGS);
  const layout = useMemo(() => settle(settings), [settings]);
  const grown = useMemo(() => grownAt(layout, t), [layout, t]);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // SIZE once: offset sizes ignore the stage Camera's scale
  useLayoutEffect(() => {
    const element = box.current;
    if (element) setSize({ width: element.offsetWidth, height: element.offsetHeight });
  }, []);

  // DRAW this frame now (the renderer screenshots right after the commit)
  useLayoutEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx || size.width === 0) return;
    element.width = size.width;
    element.height = size.height;
    const { display } = settings;
    const finalCircles = layout.circles.map(({ circle }) => circle);
    const camera = fitCamera([...layout.nodes, ...circleExtents(finalCircles, CIRCLE_LABEL_ROOM)], size.width, size.height - CAPTION_BAND);
    drawGraph({
      ctx, ...size, pixelRatio: 1, camera, overviewZoom: camera.k,
      nodes: grown.nodes, links: grown.links, circles: grown.circles, display, groupBy: display.groupBy,
      palette: readCanvasPalette(element), colorOf: layout.colorOf,
      focusId: null, focusIds: new Set(), hoverLabelOnly: false, domainLabelBoxes: [],
    });
  }, [grown, layout, settings, size]);

  // The panel counts the nodes that have arrived so far
  const arrived = new Set(grown.nodes.map((node) => node.id));
  const panelNodes = DATA.nodes.filter((node) => arrived.has(node.id) || (!layout.startAt.has(node.id) && t > 0.6));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        <div ref={box} className="relative h-full w-full overflow-hidden">
          <canvas ref={canvas} className="absolute inset-0" aria-label="Knowledge graph" role="img" style={{ width: size.width, height: size.height }} />
        </div>
        <GraphPanel
          settings={settings}
          nodes={panelNodes}
          update={(section, value) => setSettings((current) => ({ ...current, [section]: value }))}
          reset={() => setSettings(SETTINGS)}
          isReplaying={false}
          onAnimate={() => {}}
        />
        <p className="pointer-events-none absolute right-3 bottom-2 font-mono text-xs text-faint">
          {grown.nodes.length} nodes · {grown.links.length} links
        </p>
      </div>
    </div>
  );
}

function GraphScene({ t }: { t: number }) {
  return (
    <StageProviders>
      <Camera t={t} keys={[[0, 1.02, 1150, 420], [DURATION, 1.1, 1150, 420]]}>
        <StageShell>
          <StageGraph t={t} />
        </StageShell>
      </Camera>
    </StageProviders>
  );
}

export const graph: Scene = { duration: DURATION, Component: GraphScene, title: "Graph" };
