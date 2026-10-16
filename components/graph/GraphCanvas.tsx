"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { circleExtents, clusterCircles, type GraphData, type GraphNode, type GraphSettings, groupColorLookup } from "@/lib/graph";
import { type Camera, centeredCamera, fitCamera, zoomBy } from "@/lib/graph/camera";
import type { SimLink, SimNode } from "@/lib/graph/physics";
import { cn } from "@/lib/utils";
import { drawGraph } from "./drawGraph";
import { readCanvasPalette } from "./palette";
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
  // Reveal text in layers as you zoom in from the whole-graph view (off for small local graphs, where titles always fit)
  progressiveZoom?: boolean;
  // While hovering, show only the hovered dot's text (small panels, where neighbor titles pile up)
  hoverLabelOnly?: boolean;
  className?: string;
}

// How much one zoom button press zooms
const BUTTON_ZOOM = 1.5;

// Room above a ring for its label, in world units at the fitted zoom (roughly)
const CIRCLE_LABEL_ROOM = 20;

// The hovered dot and every dot it shares a link with
function focusOf(hoveredId: string | null, links: readonly SimLink[]): Set<string> {
  if (!hoveredId) return new Set();
  const focus = new Set([hoveredId]);
  for (const link of links) {
    const source = (link.source as SimNode).id;
    const target = (link.target as SimNode).id;
    if (source === hoveredId) focus.add(target);
    if (target === hoveredId) focus.add(source);
  }
  return focus;
}

// CANVAS SIZE: keeps the backing store sharp on high-density screens
function useCanvasSize(container: React.RefObject<HTMLDivElement | null>, canvas: React.RefObject<HTMLCanvasElement | null>, onResize: (width: number, height: number) => void) {
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

export function GraphCanvas({ graph, settings, onOpen, progressiveZoom = true, hoverLabelOnly = false, className }: GraphCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useRef({ width: 0, height: 0 });
  const camera = useRef<Camera>(centeredCamera(0, 0));
  // Keeps the whole graph in view while it settles, until the person pans, zooms or drags
  const isAutoFit = useRef(true);
  const hoveredId = useRef<string | null>(null);
  const frame = useRef<number | null>(null);
  const redrawRef = useRef<() => void>(() => {});
  const colorOf = useMemo(() => groupColorLookup(settings.groups), [settings.groups]);
  const latest = useRef({ display: settings.display, colorOf, progressiveZoom, hoverLabelOnly });
  // The domain circles toggle also turns off the pull that gathers dots by domain
  const forces = useMemo(
    () => (settings.display.domainCircles ? settings.forces : { ...settings.forces, cluster: 0 }),
    [settings.forces, settings.display.domainCircles],
  );
  const layout = useForceLayout(graph, forces, settings.display.nodeSize, redrawRef);

  // DRAW NOW: paints the current layout with the latest settings
  const drawNow = useCallback(() => {
    frame.current = null;
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx || size.current.width === 0) return;
    const { nodes, links } = layout.current;
    const { display } = latest.current;
    const circles = display.domainCircles ? clusterCircles(nodes, display.nodeSize) : [];
    const overview = fitCamera([...nodes, ...circleExtents(circles, CIRCLE_LABEL_ROOM)], size.current.width, size.current.height);
    if (isAutoFit.current) camera.current = overview;
    drawGraph({
      ctx,
      ...size.current,
      pixelRatio: window.devicePixelRatio || 1,
      camera: camera.current,
      overviewZoom: latest.current.progressiveZoom ? overview.k : null,
      nodes,
      links,
      circles,
      display,
      palette: readCanvasPalette(element),
      colorOf: latest.current.colorOf,
      hoveredId: hoveredId.current,
      focusIds: focusOf(hoveredId.current, links),
      hoverLabelOnly: latest.current.hoverLabelOnly,
    });
  }, [layout]);

  // REDRAW: one frame per animation frame, however many changes ask
  const redraw = useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(drawNow);
  }, [drawNow]);

  // LATEST VALUES for the frame loop (synced after render; the loop runs outside React)
  useLayoutEffect(() => {
    redrawRef.current = redraw;
    latest.current = { display: settings.display, colorOf, progressiveZoom, hoverLabelOnly };
  }, [redraw, settings.display, colorOf, progressiveZoom, hoverLabelOnly]);

  // RESIZE: the first size centers the camera; later ones keep the view (or refit, while auto-fitting)
  const onResize = useCallback(
    (width: number, height: number) => {
      if (size.current.width === 0) camera.current = centeredCamera(width, height, camera.current.k);
      size.current = { width, height };
      redraw();
    },
    [redraw],
  );
  useCanvasSize(container, canvas, onResize);
  usePointerControls({ canvas, layout, camera, hoveredId, isAutoFit, nodeSize: settings.display.nodeSize, onOpen, redraw });

  // ZOOM BUTTONS: zoom around the canvas center; fit hands the camera back to auto-fit
  const zoomCenter = useCallback(
    (factor: number) => {
      isAutoFit.current = false;
      camera.current = zoomBy(camera.current, { x: size.current.width / 2, y: size.current.height / 2 }, factor);
      redraw();
    },
    [redraw],
  );
  const fitView = useCallback(() => {
    isAutoFit.current = true;
    redraw();
  }, [redraw]);

  // REDRAW when display settings or groups change (no layout change needed)
  useEffect(redraw, [redraw, settings.display, colorOf]);
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
    <div ref={container} className={cn("relative h-full w-full overflow-hidden", className)}>
      <canvas ref={canvas} className="absolute inset-0 touch-none" aria-label="Knowledge graph" role="img" />
      <ZoomControls onZoomIn={() => zoomCenter(BUTTON_ZOOM)} onZoomOut={() => zoomCenter(1 / BUTTON_ZOOM)} onFit={fitView} />
    </div>
  );
}
