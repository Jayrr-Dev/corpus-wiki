"use client";

import { Button } from "@/components/ui/button";
import {
  circleAt,
  circleExtents,
  circleNestedIn,
  circleOpenTarget,
  clusterCircles,
  groupColorLookup,
  moveTarget,
  nodeInCluster,
  primaryEntityName,
  primaryPageTitle,
  type CircleOpenTarget,
  type ClusterMode,
  type GraphColor,
  type GraphData,
  type GraphNode,
  type GraphSettings,
} from "@/lib/graph";
import {
  centeredCamera,
  fitCamera,
  hierarchyOpacity,
  zoomBy,
  type Camera,
  type Point,
} from "@/lib/graph/camera";
import { entityColor } from "@/lib/graph/domainColors";
import { nodeRadius, type SimLink, type SimNode } from "@/lib/graph/physics";
import { cn } from "@/lib/utils";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { drawGraph } from "./drawGraph";
import { readCanvasPalette } from "./palette";
import { useCameraMotion } from "./useCameraMotion";
import { useForceLayout } from "./useForceLayout";
import { usePointerControls } from "./usePointerControls";
import { ZoomControls } from "./ZoomControls";

// =====================================================================
// GRAPH CANVAS: one <canvas> filling its parent. Owns the frame loop:
// any change (a layout tick, a hover, a pan, a setting) asks for one
// redraw, and at most one frame is drawn per animation frame.
// =====================================================================

export interface GraphCanvasProps {
  graph: GraphData;
  settings: Pick<GraphSettings, "display" | "forces" | "groups">;
  onOpen: (node: GraphNode) => void;
  selectedIds?: string[];
  onSelect?: (nodes: GraphNode[], toggle: boolean) => void;
  onContextDomain?: (path: string, point: Point) => void;
  onContextNode?: (node: GraphNode, point: Point) => void;
  onFocusDomain?: (path: string | null) => void;
  // Second click on a selected article, section, or suggestion circle.
  onOpenCircle?: (target: CircleOpenTarget) => void;
  onMoveNode?: (node: GraphNode, path: string) => void;
  // Reveal text in layers as you zoom in from the whole-graph view (off for small local graphs, where titles always fit)
  progressiveZoom?: boolean;
  // While a dot is focused, show only its text (small panels, where neighbor titles pile up)
  hoverLabelOnly?: boolean;
  className?: string;
}

// How much one zoom button press zooms
const BUTTON_ZOOM = 1.5;

// Room above a ring for its label, in world units at the fitted zoom (roughly)
const CIRCLE_LABEL_ROOM = 26;

// How long the rest of the graph takes to fade out (or back) when a dot is focused or let go
const FOCUS_FADE_MS = 280;

// The focused dot and every dot it shares a link with
function focusOf(
  focusId: string | null,
  links: readonly SimLink[],
): Set<string> {
  if (!focusId) return new Set();
  const focus = new Set([focusId]);
  for (const link of links) {
    const source = (link.source as SimNode).id;
    const target = (link.target as SimNode).id;
    if (source === focusId) focus.add(target);
    if (target === focusId) focus.add(source);
  }
  return focus;
}

// CANVAS SIZE: keeps the backing store sharp on high-density screens
function useCanvasSize(
  container: React.RefObject<HTMLDivElement | null>,
  canvas: React.RefObject<HTMLCanvasElement | null>,
  onResize: (width: number, height: number) => void,
) {
  useEffect(() => {
    const box = container.current;
    const element = canvas.current;
    if (!box || !element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const ratio = window.devicePixelRatio || 1;
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      element.style.width = `${width}px`;
      element.style.height = `${height}px`;
      onResize(width, height);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [container, canvas, onResize]);
}

export function GraphCanvas({
  graph,
  settings,
  onOpen,
  onContextNode,
  onContextDomain,
  onFocusDomain,
  onOpenCircle,
  onMoveNode,
  selectedIds = [],
  onSelect,
  progressiveZoom = true,
  hoverLabelOnly = false,
  className,
}: GraphCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const domainLabelBoxes = useRef<
    { path: string; x: number; y: number; width: number; height: number }[]
  >([]);
  const size = useRef({ width: 0, height: 0 });
  const camera = useRef<Camera>(centeredCamera(0, 0));
  // Keeps the whole graph in view while it settles, until the person pans, zooms or drags
  const isAutoFit = useRef(true);
  const hoveredId = useRef<string | null>(null);
  // The clicked dot, and the fade toward it: `mix` eases to 1 while a dot is focused and back to 0
  // after; the old dot stays in `id` until the fade out ends, so it does not snap off
  const focusedId = useRef<string | null>(null);
  const focusFade = useRef({ id: null as string | null, mix: 0, at: 0 });
  const [focusedDomain, setFocusedDomain] = useState<string | null>(null);
  const [selectionBox, setSelectionBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const dropHint = useRef<string | null>(null);
  const [dropLabel, setDropLabel] = useState<string | null>(null);
  const selection = useRef(selectedIds);
  useLayoutEffect(() => {
    selection.current = selectedIds;
    redrawRef.current();
  }, [selectedIds]);
  const frame = useRef<number | null>(null);
  const redrawRef = useRef<() => void>(() => {});
  const groupBy = settings.display.groupBy;
  const clusterMode: ClusterMode =
    groupBy === "entity" || groupBy === "page" ? groupBy : "domain";
  const colorOf = useMemo(() => {
    const byGroup = groupColorLookup(settings.groups);
    if (groupBy === "entity") {
      return (node: GraphNode) => {
        if (node.kind === "domain") return null;
        const name = primaryEntityName(node);
        return name ? entityColor(name) : null;
      };
    }
    if (groupBy === "page") {
      return (node: GraphNode) => {
        if (node.kind === "domain") return null;
        const title = primaryPageTitle(node);
        if (title) return entityColor(title);
        if (!node.recommendedTitle) return "muted";
        return node.recommendedKind === "merge" ? "needs-you" : "link";
      };
    }
    return byGroup;
  }, [settings.groups, groupBy]);
  // Circles off also turns off the pull that gathers dots into a group
  const forces = useMemo(
    () =>
      groupBy === "off" ? { ...settings.forces, cluster: 0 } : settings.forces,
    [settings.forces, groupBy],
  );
  // Circles come from the packing, so they only match the dots while the group pull is on
  const showCircles = groupBy !== "off" && forces.cluster > 0;
  const latest = useRef<{
    display: GraphSettings["display"];
    showCircles: boolean;
    groupBy: GraphSettings["display"]["groupBy"];
    clusterMode: ClusterMode;
    colorOf: (node: GraphNode) => GraphColor | null;
    progressiveZoom: boolean;
    hoverLabelOnly: boolean;
    focusedDomain: string | null;
  }>({
    display: settings.display,
    showCircles,
    groupBy,
    clusterMode,
    colorOf,
    progressiveZoom,
    hoverLabelOnly,
    focusedDomain,
  });
  const layout = useForceLayout(
    graph,
    forces,
    settings.display.nodeSize,
    redrawRef,
    clusterMode,
    colorOf,
  );
  const geometry = useRef<{
    nodes: SimNode[];
    revision: number;
    nodeSize: number;
    groupBy: GraphSettings["display"]["groupBy"];
    width: number;
    height: number;
    circles: ReturnType<typeof clusterCircles>;
    overview: Camera;
  } | null>(null);

  // DRAW NOW: paints the current layout with the latest settings
  // The stable callback intentionally reads the latest mutable simulation on each frame.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const drawNow = useCallback(() => {
    frame.current = null;
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx || size.current.width === 0) return;
    const { nodes, links, revision } = layout.current;
    const {
      display,
      showCircles,
      groupBy: shownGroup,
      clusterMode: mode,
    } = latest.current;
    let bounds = geometry.current;
    if (
      !bounds ||
      bounds.nodes !== nodes ||
      bounds.revision !== revision ||
      bounds.nodeSize !== display.nodeSize ||
      bounds.groupBy !== shownGroup ||
      bounds.width !== size.current.width ||
      bounds.height !== size.current.height
    ) {
      const circles = showCircles
        ? clusterCircles(nodes, display.nodeSize, mode, links)
        : [];
      bounds = {
        nodes,
        revision,
        nodeSize: display.nodeSize,
        groupBy: shownGroup,
        ...size.current,
        circles,
        overview: fitCamera(
          [...nodes, ...circleExtents(circles, CIRCLE_LABEL_ROOM)],
          size.current.width,
          size.current.height,
        ),
      };
      geometry.current = bounds;
    }
    const { circles, overview } = bounds;
    const palette = readCanvasPalette(element);
    if (isAutoFit.current) camera.current = overview;
    domainLabelBoxes.current = [];
    // FOCUS FADE: step the mix toward its target and keep frames coming until it gets there
    const fade = focusFade.current;
    const now = performance.now();
    const step =
      fade.at === 0 ? 1 : Math.min(1, (now - fade.at) / FOCUS_FADE_MS);
    if (focusedId.current !== null) fade.id = focusedId.current;
    const target = focusedId.current === null ? 0 : 1;
    fade.mix =
      target > fade.mix
        ? Math.min(target, fade.mix + step)
        : Math.max(target, fade.mix - step);
    if (fade.mix === 0) fade.id = null;
    fade.at = fade.mix === target ? 0 : now;
    if (fade.at !== 0) redrawRef.current();
    drawGraph({
      domainLabelBoxes: domainLabelBoxes.current,
      ctx,
      ...size.current,
      pixelRatio: window.devicePixelRatio || 1,
      camera: camera.current,
      overviewZoom: latest.current.progressiveZoom ? overview.k : null,
      nodes,
      links,
      circles,
      display,
      groupBy: shownGroup,
      palette,
      colorOf: latest.current.colorOf,
      focusId: fade.id,
      // Smoothstep: the fade starts and ends gently
      focusMix: fade.mix * fade.mix * (3 - 2 * fade.mix),
      hoveredId: hoveredId.current,
      focusIds: focusOf(fade.id, links),
      hoverLabelOnly: latest.current.hoverLabelOnly,
      focusedDomain: latest.current.focusedDomain,
    });
    ctx.save();
    ctx.setTransform(
      window.devicePixelRatio || 1,
      0,
      0,
      window.devicePixelRatio || 1,
      0,
      0,
    );
    const link = palette.token("link");
    ctx.strokeStyle = link;
    ctx.fillStyle = link;
    ctx.lineWidth = 3;
    const selected = new Set(selection.current);
    for (const node of nodes)
      if (selected.has(node.id)) {
        ctx.beginPath();
        ctx.arc(
          (node.x ?? 0) * camera.current.k + camera.current.x,
          (node.y ?? 0) * camera.current.k + camera.current.y,
          nodeRadius(node, display.nodeSize) * camera.current.k + 5,
          0,
          Math.PI * 2,
        );
        ctx.globalAlpha = 0.16;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
      }
    const hint = dropHint.current
      ? circles.find((circle) => circle.key === dropHint.current)
      : null;
    if (hint) {
      ctx.beginPath();
      ctx.arc(
        hint.x * camera.current.k + camera.current.x,
        hint.y * camera.current.k + camera.current.y,
        hint.r * camera.current.k,
        0,
        Math.PI * 2,
      );
      ctx.lineWidth = 4;
      ctx.setLineDash([]);
      ctx.stroke();
    }
    ctx.restore();
  }, [layout]);

  // REDRAW: one frame per animation frame, however many changes ask
  const redraw = useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(drawNow);
  }, [drawNow]);
  const motion = useCameraMotion(camera, redraw);

  // LATEST VALUES for the frame loop (synced after render; the loop runs outside React)
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- Shared ref is the force simulation callback bridge.
    redrawRef.current = redraw;
    latest.current = {
      display: settings.display,
      showCircles,
      groupBy,
      clusterMode,
      colorOf,
      progressiveZoom,
      hoverLabelOnly,
      focusedDomain,
    };
  }, [
    redraw,
    settings.display,
    showCircles,
    groupBy,
    clusterMode,
    colorOf,
    progressiveZoom,
    hoverLabelOnly,
    focusedDomain,
  ]);

  // RESIZE: the first size centers the camera; later ones keep the view (or refit, while auto-fitting)
  const onResize = useCallback(
    (width: number, height: number) => {
      if (size.current.width === 0)
        camera.current = centeredCamera(width, height, camera.current.k);
      size.current = { width, height };
      redraw();
    },
    [redraw],
  );
  useCanvasSize(container, canvas, onResize);
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- Read current simulation positions when invoked.
  const fitView = useCallback(() => {
    const { nodes } = layout.current;
    const circles = showCircles
      ? clusterCircles(
          nodes,
          settings.display.nodeSize,
          clusterMode,
          layout.current.links,
        )
      : [];
    const overview = fitCamera(
      [...nodes, ...circleExtents(circles, CIRCLE_LABEL_ROOM)],
      size.current.width,
      size.current.height,
    );
    setFocusedDomain(null);
    onFocusDomain?.(null);
    hoveredId.current = null;
    focusedId.current = null;
    isAutoFit.current = false;
    motion.animateTo(overview, () => {
      isAutoFit.current = true;
      redraw();
    });
  }, [
    layout,
    showCircles,
    clusterMode,
    settings.display.nodeSize,
    motion,
    redraw,
    onFocusDomain,
  ]);
  const focusGroup = useCallback(
    // eslint-disable-next-line react-hooks/preserve-manual-memoization -- Read current simulation positions when invoked.
    (point: Point) => {
      if (!progressiveZoom || !showCircles) return;
      const { nodes } = layout.current;
      const circles = clusterCircles(
        nodes,
        settings.display.nodeSize,
        clusterMode,
        layout.current.links,
      );
      const overview = fitCamera(
        [...nodes, ...circleExtents(circles, CIRCLE_LABEL_ROOM)],
        size.current.width,
        size.current.height,
      );
      const picked = circles
        .filter(
          (circle) =>
            hierarchyOpacity(circle.depth, camera.current.k, overview.k) >
              0.5 &&
            Math.hypot(point.x - circle.x, point.y - circle.y) <= circle.r,
        )
        .sort((a, b) => b.depth - a.depth || a.r - b.r)[0];
      if (!picked) {
        fitView();
        return;
      }
      // A neighboring bubble takes focus directly. Clicking the active bubble
      // again opens that article, section, or suggestion.
      if (picked.key === latest.current.focusedDomain) {
        const target = circleOpenTarget(picked, clusterMode);
        if (target) onOpenCircle?.(target);
        return;
      }
      setFocusedDomain(picked.key);
      onFocusDomain?.(picked.key);
      const members = nodes.filter((node) =>
        nodeInCluster(node, picked.key, clusterMode),
      );
      const childRings = circles.filter(
        (circle) =>
          circle.key === picked.key ||
          circleNestedIn(circle.key, picked.key, clusterMode),
      );
      const fitted = fitCamera(
        [...members, ...circleExtents(childRings, CIRCLE_LABEL_ROOM)],
        size.current.width,
        size.current.height,
        70,
      );
      motion.animateTo(fitted);
      hoveredId.current = null;
      focusedId.current = null;
      isAutoFit.current = false;
      redraw();
    },
    [
      layout,
      progressiveZoom,
      showCircles,
      clusterMode,
      settings.display,
      redraw,
      motion,
      fitView,
      onFocusDomain,
      onOpenCircle,
    ],
  );
  // FOCUS A DOT: start the fade toward it (null lets go)
  const focusNode = useCallback(
    (id: string | null) => {
      focusedId.current = id;
      focusFade.current.at = performance.now();
      redraw();
    },
    [redraw],
  );
  // Claims file into domain circles only. Entity circles are not filing targets.
  const canDrop = Boolean(onMoveNode) && groupBy === "domain";
  const showDrop = (node: SimNode | null, world: Point) => {
    const hit =
      node && latest.current.showCircles && latest.current.groupBy === "domain"
        ? circleAt(
            clusterCircles(
              layout.current.nodes,
              latest.current.display.nodeSize,
              "domain",
              layout.current.links,
            ),
            world,
          )
        : null;
    const path = node
      ? moveTarget(node, hit, latest.current.focusedDomain)
      : null;
    if (dropHint.current === path) return;
    dropHint.current = path;
    setDropLabel(path);
    redraw();
  };
  const dropNode = (node: SimNode, world: Point) => {
    showDrop(node, world);
    const path = dropHint.current;
    dropHint.current = null;
    setDropLabel(null);
    if (path) onMoveNode?.(node, path);
  };
  usePointerControls({
    canvas,
    layout,
    camera,
    hoveredId,
    focusedId,
    isAutoFit,
    nodeSize: settings.display.nodeSize,
    onOpen,
    onFocus: focusNode,
    onContextNode,
    onContextTitle: (point, client) => {
      const label = [...domainLabelBoxes.current]
        .reverse()
        .find(
          (b) =>
            point.x >= b.x - 5 &&
            point.x <= b.x + b.width + 5 &&
            point.y >= b.y - 4 &&
            point.y <= b.y + b.height + 4,
        );
      if (!label || !onContextDomain || groupBy !== "domain") return false;
      onContextDomain(label.path, client);
      return true;
    },
    onSelect: onSelect
      ? (nodes, toggle) =>
          onSelect(
            nodes.filter(
              (n) =>
                !focusedDomain || nodeInCluster(n, focusedDomain, clusterMode),
            ),
            toggle,
          )
      : undefined,
    onSelectionBox: setSelectionBox,
    onBackgroundClick: focusGroup,
    onNodeDrag: canDrop ? showDrop : undefined,
    onNodeDrop: canDrop ? dropNode : undefined,
    motion,
    redraw,
  });

  // ZOOM BUTTONS: zoom around the canvas center; fit hands the camera back to auto-fit
  const zoomCenter = useCallback(
    (factor: number) => {
      isAutoFit.current = false;
      motion.animateTo(
        zoomBy(
          motion.target.current ?? camera.current,
          { x: size.current.width / 2, y: size.current.height / 2 },
          factor,
        ),
      );
      redraw();
    },
    [redraw, motion],
  );

  // REDRAW when display settings or groups change (no layout change needed)
  useEffect(redraw, [
    redraw,
    settings.display,
    showCircles,
    groupBy,
    colorOf,
    focusedDomain,
  ]);
  // CLEANUP: cancel a pending frame and clear the handle, so a remount (React dev's double
  // mount) can schedule frames again
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );

  return (
    <div
      ref={container}
      className={cn("relative h-full w-full overflow-hidden", className)}
    >
      <canvas
        ref={canvas}
        className="absolute inset-0 touch-none"
        aria-label="Knowledge graph"
        role="img"
      />
      {selectionBox && (
        <div
          className="pointer-events-none absolute left-[var(--box-x)] top-[var(--box-y)] h-[var(--box-h)] w-[var(--box-w)] border-2 border-link bg-link/15"
          style={
            {
              "--box-x": `${selectionBox.x}px`,
              "--box-y": `${selectionBox.y}px`,
              "--box-w": `${selectionBox.width}px`,
              "--box-h": `${selectionBox.height}px`,
            } as CSSProperties
          }
        />
      )}
      {dropLabel && (
        <p
          role="status"
          className="pointer-events-none absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-md border bg-background px-3 py-1 text-sm shadow-md"
        >
          Drop to move into {dropLabel}
        </p>
      )}
      <ZoomControls
        onZoomIn={() => zoomCenter(BUTTON_ZOOM)}
        onZoomOut={() => zoomCenter(1 / BUTTON_ZOOM)}
        onFit={fitView}
      />
      {focusedDomain && (
        <Button
          type="button"
          variant="outline"
          className="absolute top-3 right-3"
          onClick={fitView}
        >
          Back to overview
        </Button>
      )}
      {progressiveZoom && (
        <p className="pointer-events-none absolute bottom-2 left-3 text-xs text-muted-foreground">
          Scroll to zoom · Drag a claim into another domain · Click a dot twice
          to open · Ctrl-drag to select
        </p>
      )}
    </div>
  );
}
