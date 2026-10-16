"use client";

import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { type Camera, panBy, pinchStep, type Point, toWorld, zoomAt, zoomBy } from "@/lib/graph/camera";
import { nodeRadius, type SimNode } from "@/lib/graph/physics";
import type { ForceLayout } from "./useForceLayout";

// =====================================================================
// POINTER CONTROLS (Obsidian's canvas behavior):
//   hover a dot   -> focus it and its neighbors
//   click a dot   -> open it
//   drag a dot    -> pin it to the pointer while the layout reacts
//   drag empty    -> pan;  wheel -> zoom around the cursor
// Touch adds:
//   pinch         -> zoom around the fingers, and pan as they move
//   double-tap    -> zoom in around the tap (double-click does the same)
// The camera and hover live in refs: they change every frame and only
// the canvas needs them, so they never re-render React.
// =====================================================================

// A press that moves less than this is a click, not a drag (fingers wobble more than a mouse)
const CLICK_SLOP_PX = 4;
const TAP_SLOP_PX = 10;
// Two taps this close in time and space are a double-tap
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;
// How much one double-tap zooms in
const DOUBLE_TAP_ZOOM = 2;
// Layout heat while a dot is being dragged
const DRAG_ALPHA_TARGET = 0.3;

type Gesture =
  | { mode: "idle" }
  | { mode: "pan"; last: Point; start: Point | null }
  | { mode: "drag"; node: SimNode; start: Point; offset: Point; moved: boolean; slop: number }
  | { mode: "pinch"; mid: Point; distance: number };

interface PointerOptions {
  canvas: RefObject<HTMLCanvasElement | null>;
  layout: RefObject<ForceLayout>;
  camera: RefObject<Camera>;
  hoveredId: RefObject<string | null>;
  // Set false once the person moves the view themselves
  isAutoFit: RefObject<boolean>;
  nodeSize: number;
  onOpen: (node: SimNode) => void;
  onBackgroundClick?: (world: Point) => void;
  motion: { animateTo: (next: Camera) => void; cancel: () => void; target: RefObject<Camera | null> };
  redraw: () => void;
}

// Pointer position relative to the canvas
function localPoint(canvas: HTMLCanvasElement, event: { clientX: number; clientY: number }): Point {
  const box = canvas.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

// PINCH SHAPE: the midpoint and spread of the first two fingers down
function pinchOf(points: Iterable<Point>): { mid: Point; distance: number } {
  const [a, b] = [...points] as [Point, Point];
  return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(a.x - b.x, a.y - b.y) };
}

// The top-most dot under a world point (last drawn = on top), with a little slack for small dots
function nodeAt(nodes: readonly SimNode[], world: Point, nodeSize: number, zoom: number): SimNode | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]!;
    const reach = nodeRadius(node, nodeSize) + 3 / zoom;
    if (Math.hypot((node.x ?? 0) - world.x, (node.y ?? 0) - world.y) <= reach) return node;
  }
  return null;
}

// Wires the canvas's pointer and wheel events to the camera, hover and layout
export function usePointerControls({ canvas, layout, camera, hoveredId, isAutoFit, nodeSize, onOpen, onBackgroundClick, motion, redraw }: PointerOptions): void {
  const latest = useRef({ nodeSize, onOpen, onBackgroundClick, redraw });
  // Latest props for the listeners below (synced after render, read in events)
  useLayoutEffect(() => {
    latest.current = { nodeSize, onOpen, onBackgroundClick, redraw };
  }, [nodeSize, onOpen, onBackgroundClick, redraw]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let gesture: Gesture = { mode: "idle" };
    // Every finger or mouse currently pressed on the canvas, by pointer id
    const pressed = new Map<number, Point>();
    let lastTap: { time: number; point: Point } | null = null;
    // Touch double-taps zoom in onUp; some browsers also fire dblclick for them, which must not zoom twice
    let lastPointerType = "mouse";
    const hitTest = (point: Point) =>
      nodeAt(layout.current.nodes, toWorld(camera.current, point), latest.current.nodeSize, camera.current.k);

    // LET GO OF A DOT: unpin it and cool the layout back down
    const releaseDrag = () => {
      if (gesture.mode !== "drag") return;
      gesture.node.fx = null;
      gesture.node.fy = null;
      layout.current.simulation?.alphaTarget(0);
    };

    // ZOOM IN AT A POINT (double-tap / double-click)
    const zoomInAt = (point: Point) => {
      isAutoFit.current = false;
      motion.animateTo(zoomBy(motion.target.current ?? camera.current, point, DOUBLE_TAP_ZOOM));
      latest.current.redraw();
    };

    // PRESS: a second finger starts a pinch; otherwise start dragging a dot, or panning
    const onDown = (event: PointerEvent) => {
      motion.cancel();
      const point = localPoint(element, event);
      lastPointerType = event.pointerType;
      element.setPointerCapture(event.pointerId);
      pressed.set(event.pointerId, point);
      isAutoFit.current = false;
      if (pressed.size >= 2) {
        releaseDrag();
        gesture = { mode: "pinch", ...pinchOf(pressed.values()) };
        return;
      }
      const node = hitTest(point);
      if (!node) {
        gesture = { mode: "pan", last: point, start: point };
        return;
      }
      const world = toWorld(camera.current, point);
      gesture = { mode: "drag", node, start: point, offset: { x: world.x - (node.x ?? 0), y: world.y - (node.y ?? 0) }, moved: false, slop: event.pointerType === "touch" ? TAP_SLOP_PX : CLICK_SLOP_PX };
      node.fx = node.x;
      node.fy = node.y;
    };

    // MOVE: pinch, drag, pan, or update the hover focus
    const onMove = (event: PointerEvent) => {
      const point = localPoint(element, event);
      if (pressed.has(event.pointerId)) pressed.set(event.pointerId, point);
      if (gesture.mode === "pinch") {
        if (pressed.size < 2) return;
        const next = pinchOf(pressed.values());
        camera.current = pinchStep(camera.current, gesture, next);
        gesture = { mode: "pinch", ...next };
      } else if (gesture.mode === "drag") {
        if (!gesture.moved) {
          if (Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) < gesture.slop) return;
          gesture.moved = true;
          layout.current.simulation?.alphaTarget(DRAG_ALPHA_TARGET).restart();
        }
        const world = toWorld(camera.current, point);
        gesture.node.fx = world.x - gesture.offset.x;
        gesture.node.fy = world.y - gesture.offset.y;
      } else if (gesture.mode === "pan") {
        camera.current = panBy(camera.current, point.x - gesture.last.x, point.y - gesture.last.y);
        gesture.last = point;
      } else {
        const id = hitTest(point)?.id ?? null;
        if (id === hoveredId.current) return;
        hoveredId.current = id;
        element.style.cursor = id ? "pointer" : "default";
      }
      latest.current.redraw();
    };

    // TAP CHECK: a second quick tap near the first zooms in; returns true when it did
    const isDoubleTap = (event: PointerEvent, point: Point): boolean => {
      if (event.pointerType !== "touch") return false;
      const now = event.timeStamp;
      const isDouble = lastTap !== null && now - lastTap.time < DOUBLE_TAP_MS && Math.hypot(point.x - lastTap.point.x, point.y - lastTap.point.y) < DOUBLE_TAP_PX;
      lastTap = isDouble ? null : { time: now, point };
      return isDouble;
    };

    // RELEASE: a short press on a dot opens it; a dragged dot is let go; a pinch ends when a finger lifts
    const onUp = (event: PointerEvent) => {
      const point = localPoint(element, event);
      pressed.delete(event.pointerId);
      if (gesture.mode === "pinch") {
        // the finger left behind keeps panning, so the view doesn't jump
        const [remaining] = pressed.values();
        gesture = remaining ? { mode: "pan", last: remaining, start: null } : { mode: "idle" };
        return;
      }
      const slop = event.pointerType === "touch" ? TAP_SLOP_PX : CLICK_SLOP_PX;
      if (gesture.mode === "drag") {
        const { node, moved } = gesture;
        releaseDrag();
        if (!moved) latest.current.onOpen(node);
      } else if (gesture.mode === "pan" && gesture.start && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) < slop) {
        if (isDoubleTap(event, point)) zoomInAt(point);
        else latest.current.onBackgroundClick?.(toWorld(camera.current, point));
      }
      gesture = { mode: "idle" };
    };

    // CANCEL: the browser took the gesture over (e.g. a system swipe); drop it cleanly
    const onCancel = (event: PointerEvent) => {
      pressed.delete(event.pointerId);
      releaseDrag();
      gesture = { mode: "idle" };
    };

    // DOUBLE-CLICK: mouse equivalent of double-tap, on empty space only (a dot opens on click)
    const onDoubleClick = (event: MouseEvent) => {
      if (lastPointerType === "touch") return;
      const point = localPoint(element, event);
      if (!hitTest(point)) zoomInAt(point);
    };

    // WHEEL: zoom around the cursor (non-passive so the page does not scroll)
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      isAutoFit.current = false;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      motion.animateTo(zoomAt(motion.target.current ?? camera.current, localPoint(element, event), Math.max(-160, Math.min(160, delta))));
      latest.current.redraw();
    };

    // LEAVE: drop the hover focus
    const onLeave = () => {
      if (hoveredId.current === null) return;
      hoveredId.current = null;
      latest.current.redraw();
    };

    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointercancel", onCancel);
    element.addEventListener("pointerleave", onLeave);
    element.addEventListener("dblclick", onDoubleClick);
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onCancel);
      element.removeEventListener("pointerleave", onLeave);
      element.removeEventListener("dblclick", onDoubleClick);
      element.removeEventListener("wheel", onWheel);
    };
  }, [canvas, layout, camera, hoveredId, isAutoFit, motion]);
}
