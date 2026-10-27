"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { circleExtents, clusterCircles, groupColorLookup, nodeInCluster, primaryEntityName, type GraphData, type GraphNode, type GraphSettings } from "@/lib/graph";
import { entityColor } from "@/lib/graph/domainColors";
import { type Camera, centeredCamera, fitCamera, hierarchyOpacity, type Point, zoomBy } from "@/lib/graph/camera";
import { Button } from "@/components/ui/button";
import { nodeRadius, type SimLink, type SimNode } from "@/lib/graph/physics";
import { cn } from "@/lib/utils";
import { drawGraph } from "./drawGraph";
import { readCanvasPalette } from "./palette";
import { placePreview, previewView, type Side } from "./placePreview";
import { NodePreviewDialog } from "./UnitPreviewDialog";
import { useForceLayout } from "./useForceLayout";
import { usePointerControls } from "./usePointerControls";
import { useCameraMotion } from "./useCameraMotion";
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
  // The open node card. The canvas keeps it beside this dot while the view moves.
  openNode?: GraphNode | null;
  onCloseNode?: () => void;
  selectedIds?: string[];
  onSelect?: (nodes: GraphNode[], toggle: boolean) => void;
  onContextDomain?: (path:string, point:Point) => void;
  onContextNode?: (node: GraphNode, point: Point) => void;
  onFocusDomain?: (path: string | null) => void;
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

export function GraphCanvas({ graph, settings, onOpen, openNode = null, onCloseNode, onContextNode, onContextDomain, onFocusDomain, selectedIds = [], onSelect, progressiveZoom = true, hoverLabelOnly = false, className }: GraphCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const domainLabelBoxes=useRef<{path:string;x:number;y:number;width:number;height:number}[]>([]);
  const size = useRef({ width: 0, height: 0 });
  const camera = useRef<Camera>(centeredCamera(0, 0));
  // Keeps the whole graph in view while it settles, until the person pans, zooms or drags
  const isAutoFit = useRef(true);
  const hoveredId = useRef<string | null>(null);
  const [focusedDomain, setFocusedDomain] = useState<string | null>(null);
  const [selectionBox,setSelectionBox] = useState<{x:number;y:number;width:number;height:number}|null>(null);
  const selection = useRef(selectedIds);
  useLayoutEffect(() => { selection.current = selectedIds; redrawRef.current(); }, [selectedIds]);
  const frame = useRef<number | null>(null);
  const redrawRef = useRef<() => void>(() => {});
  const previewEl = useRef<HTMLDivElement>(null);
  const openNodeRef = useRef(openNode);
  const onCloseNodeRef = useRef(onCloseNode);
  const previewSide = useRef<Side | undefined>(undefined);
  const previewNodeId = useRef<string | null>(null);
  const syncPreviewRef = useRef<() => void>(() => {});
  const groupBy = settings.display.groupBy;
  const clusterMode = groupBy === "entity" ? "entity" : "domain";
  const colorOf = useMemo(() => {
    const byGroup = groupColorLookup(settings.groups);
    if (groupBy !== "entity") return byGroup;
    return (node: GraphNode) => {
      const name = primaryEntityName(node);
      return name ? entityColor(name) : null;
    };
  }, [settings.groups, groupBy]);
  const latest = useRef({ display: settings.display, colorOf, progressiveZoom, hoverLabelOnly, focusedDomain, groupBy });
  // Circles off also turns off the pull that gathers dots into a group
  const forces = useMemo(
    () => (groupBy === "off" ? { ...settings.forces, cluster: 0 } : settings.forces),
    [settings.forces, groupBy],
  );
  const layout = useForceLayout(graph, forces, settings.display.nodeSize, redrawRef, clusterMode);
  const geometry = useRef<{
    nodes: SimNode[]; revision: number; nodeSize: number; groupBy: GraphSettings["display"]["groupBy"];
    width: number; height: number; circles: ReturnType<typeof clusterCircles>; overview: Camera;
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
    const { display, groupBy: shownGroup } = latest.current;
    let bounds = geometry.current;
    if (!bounds || bounds.nodes !== nodes || bounds.revision !== revision || bounds.nodeSize !== display.nodeSize || bounds.groupBy !== shownGroup || bounds.width !== size.current.width || bounds.height !== size.current.height) {
      const circles = shownGroup === "off" ? [] : clusterCircles(nodes, display.nodeSize, shownGroup === "entity" ? "entity" : "domain");
      bounds = { nodes, revision, nodeSize: display.nodeSize, groupBy: shownGroup, ...size.current,
        circles, overview: fitCamera([...nodes, ...circleExtents(circles, CIRCLE_LABEL_ROOM)], size.current.width, size.current.height) };
      geometry.current = bounds;
    }
    const { circles, overview } = bounds;
    const palette = readCanvasPalette(element);
    if (isAutoFit.current) camera.current = overview;
    domainLabelBoxes.current=[];
    drawGraph({
      domainLabelBoxes:domainLabelBoxes.current,
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
      hoveredId: hoveredId.current,
      focusIds: focusOf(hoveredId.current, links),
      hoverLabelOnly: latest.current.hoverLabelOnly,
      focusedDomain: latest.current.focusedDomain,
    });
    ctx.save();
    ctx.setTransform(window.devicePixelRatio || 1,0,0,window.devicePixelRatio || 1,0,0);
    ctx.strokeStyle = palette.token("link"); ctx.lineWidth = 3;
    const selected = new Set(selection.current);
    for (const node of nodes) if(selected.has(node.id)) {
      ctx.beginPath(); ctx.arc((node.x??0)*camera.current.k+camera.current.x,(node.y??0)*camera.current.k+camera.current.y, nodeRadius(node,display.nodeSize)*camera.current.k+5,0,Math.PI*2); ctx.stroke();
    }
    ctx.restore();
    syncPreviewRef.current();
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
    latest.current = { display: settings.display, colorOf, progressiveZoom, hoverLabelOnly, focusedDomain, groupBy };
  }, [redraw, settings.display, colorOf, progressiveZoom, hoverLabelOnly, focusedDomain, groupBy]);

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
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- Read current simulation positions when invoked.
  const fitView = useCallback(() => {
    const { nodes } = layout.current;
    const circles = groupBy === "off" ? [] : clusterCircles(nodes, settings.display.nodeSize, clusterMode);
    const overview = fitCamera([...nodes, ...circleExtents(circles, CIRCLE_LABEL_ROOM)], size.current.width, size.current.height);
    setFocusedDomain(null);
    onFocusDomain?.(null);
    hoveredId.current = null;
    isAutoFit.current = false;
    motion.animateTo(overview, () => {
      isAutoFit.current = true;
      redraw();
    });
  }, [layout, groupBy, clusterMode, settings.display.nodeSize, motion, redraw, onFocusDomain]);
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- Hit testing needs current mutable simulation positions.
  const focusGroup = useCallback((point: Point) => {
    if (!progressiveZoom || groupBy === "off") return;
    const { nodes } = layout.current;
    const circles = clusterCircles(nodes, settings.display.nodeSize, clusterMode);
    const overview = fitCamera([...nodes, ...circleExtents(circles, CIRCLE_LABEL_ROOM)], size.current.width, size.current.height);
    const picked = circles.filter((circle) => hierarchyOpacity(circle.depth, camera.current.k, overview.k) > 0.5 && Math.hypot(point.x - circle.x, point.y - circle.y) <= circle.r)
      .sort((a, b) => b.depth - a.depth || a.r - b.r)[0];
    if (!picked) {
      fitView();
      return;
    }
    // A neighboring bubble takes focus directly. Clicking the active bubble
    // keeps it focused; the overview button provides an explicit way back.
    if (picked.key === latest.current.focusedDomain) return;
    setFocusedDomain(picked.key);
    onFocusDomain?.(picked.key);
    const members = nodes.filter((node) => nodeInCluster(node, picked.key, clusterMode));
    const childRings = circles.filter((circle) => circle.key === picked.key || (clusterMode === "domain" && circle.key.startsWith(`${picked.key}/`)));
    const fitted = fitCamera([...members, ...circleExtents(childRings, CIRCLE_LABEL_ROOM)], size.current.width, size.current.height, 70);
    motion.animateTo(fitted);
    hoveredId.current = null;
    isAutoFit.current = false;
    redraw();
  }, [layout, progressiveZoom, groupBy, clusterMode, settings.display.nodeSize, redraw, motion, fitView, onFocusDomain]);
  usePointerControls({ canvas, layout, camera, hoveredId, isAutoFit, nodeSize: settings.display.nodeSize, onOpen, onContextNode, onContextTitle: (point,client) => {if(groupBy!=="domain"||!onContextDomain)return false;const label=[...domainLabelBoxes.current].reverse().find(b=>point.x>=b.x-5&&point.x<=b.x+b.width+5&&point.y>=b.y-4&&point.y<=b.y+b.height+4);if(!label)return false;onContextDomain(label.path,client);return true;}, onSelect: onSelect ? (nodes,toggle) => onSelect(nodes.filter(n=>!focusedDomain||nodeInCluster(n, focusedDomain, clusterMode)),toggle) : undefined, onSelectionBox: setSelectionBox, onBackgroundClick: focusGroup, motion, redraw });

  // ZOOM BUTTONS: zoom around the canvas center; fit hands the camera back to auto-fit
  const zoomCenter = useCallback(
    (factor: number) => {
      isAutoFit.current = false;
      motion.animateTo(zoomBy(motion.target.current ?? camera.current, { x: size.current.width / 2, y: size.current.height / 2 }, factor));
      redraw();
    },
    [redraw, motion],
  );

  // CARD POSITION: screen = world * zoom + camera. Runs on every paint, so pan,
  // zoom and the settling layout all carry the card with the dot.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- Read the live simulation and camera when the frame runs.
  const syncPreview = useCallback(() => {
    const element = previewEl.current;
    const canvasEl = canvas.current;
    const nodeId = openNodeRef.current?.id;
    if (!element || !canvasEl || !nodeId) return;
    if (previewNodeId.current !== nodeId) {
      previewNodeId.current = nodeId;
      previewSide.current = undefined;
    }
    const node = layout.current.nodes.find((item) => item.id === nodeId);
    if (!node) {
      element.classList.add("invisible", "pointer-events-none");
      element.classList.remove("pointer-events-auto");
      return;
    }
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    if (width === 0 || height === 0) return;
    const rect = canvasEl.getBoundingClientRect();
    const cameraNow = camera.current;
    const anchor = {
      x: rect.left + (node.x ?? 0) * cameraNow.k + cameraNow.x,
      y: rect.top + (node.y ?? 0) * cameraNow.k + cameraNow.y,
      radius: nodeRadius(node, latest.current.display.nodeSize) * cameraNow.k,
    };
    const card = { width, height };
    const canvasBox = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    const viewport = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    const placed = placePreview(anchor, card, previewView(canvasBox, card, viewport), previewSide.current);
    previewSide.current = placed.side;
    element.style.left = `${placed.x}px`;
    element.style.top = `${placed.y}px`;
    element.classList.remove("invisible", "pointer-events-none");
    element.classList.add("pointer-events-auto");
  }, [layout]);
  useLayoutEffect(() => {
    openNodeRef.current = openNode;
    onCloseNodeRef.current = onCloseNode;
    syncPreviewRef.current = syncPreview;
    syncPreview();
  }, [syncPreview, openNode, onCloseNode]);
  useEffect(() => {
    const element = previewEl.current;
    if (!element || !openNode) return;
    const observer = new ResizeObserver(() => syncPreview());
    observer.observe(element);
    const onMove = () => syncPreview();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof Element && target.closest("[data-slot=dialog-content]")) return;
      onCloseNodeRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [openNode, syncPreview]);

  // REDRAW when display settings or groups change (no layout change needed)
  useEffect(redraw, [redraw, settings.display, colorOf, focusedDomain]);
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
      {selectionBox && <div className="pointer-events-none absolute left-[var(--box-x)] top-[var(--box-y)] h-[var(--box-h)] w-[var(--box-w)] border-2 border-link bg-link/15" style={{"--box-x":`${selectionBox.x}px`,"--box-y":`${selectionBox.y}px`,"--box-w":`${selectionBox.width}px`,"--box-h":`${selectionBox.height}px`} as CSSProperties} />}
      <ZoomControls onZoomIn={() => zoomCenter(BUTTON_ZOOM)} onZoomOut={() => zoomCenter(1 / BUTTON_ZOOM)} onFit={fitView} />
      {focusedDomain && <Button type="button" variant="outline" className="absolute top-3 right-3" onClick={fitView}>Back to overview</Button>}
      {progressiveZoom && <p className="pointer-events-none absolute bottom-2 left-3 text-xs text-muted-foreground">Scroll to reveal detail · Click inside a group to focus · Ctrl-click or Ctrl-drag to select</p>}
      {openNode ? createPortal(
        <div
          ref={previewEl}
          role="dialog"
          aria-label={openNode.label}
          className="invisible pointer-events-none fixed z-40 flex max-h-[min(32rem,calc(100vh-1rem))] w-96 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl bg-popover text-panel text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none"
          onKeyDown={(event) => {
            if (event.key === "Escape") onCloseNode?.();
          }}
        >
          <NodePreviewDialog key={openNode.id} node={openNode} onClose={() => onCloseNode?.()} />
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

