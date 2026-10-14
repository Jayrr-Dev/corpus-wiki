"use client";

import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { type Camera, panBy, type Point, toWorld, zoomAt } from "@/lib/graph/camera";
import { nodeRadius, type SimNode } from "@/lib/graph/physics";
import type { ForceLayout } from "./useForceLayout";

// =====================================================================
// POINTER CONTROLS (Obsidian's canvas behavior):
//   hover a dot   -> focus it and its neighbors
//   click a dot   -> open it
//   drag a dot    -> pin it to the pointer while the layout reacts
//   drag empty    -> pan;  wheel -> zoom around the cursor
// The camera and hover live in refs: they change every frame and only
// the canvas needs them, so they never re-render React.
// =====================================================================

// A press that moves less than this is a click, not a drag
const CLICK_SLOP_PX = 4;
// Layout heat while a dot is being dragged
const DRAG_ALPHA_TARGET = 0.3;

type Gesture =
  | { mode: "idle" }
  | { mode: "pan"; last: Point }
  | { mode: "drag"; node: SimNode; start: Point };

interface PointerOptions {
  canvas: RefObject<HTMLCanvasElement | null>;
  layout: RefObject<ForceLayout>;
  camera: RefObject<Camera>;
  hoveredId: RefObject<string | null>;
  // Set false once the person moves the view themselves
  isAutoFit: RefObject<boolean>;
  nodeSize: number;
  onOpen: (node: SimNode) => void;
  redraw: () => void;
}

// Pointer position relative to the canvas
function localPoint(canvas: HTMLCanvasElement, event: { clientX: number; clientY: number }): Point {
  const box = canvas.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
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
export function usePointerControls({ canvas, layout, camera, hoveredId, isAutoFit, nodeSize, onOpen, redraw }: PointerOptions): void {
  const latest = useRef({ nodeSize, onOpen, redraw });
  // Latest props for the listeners below (synced after render, read in events)
  useLayoutEffect(() => {
    latest.current = { nodeSize, onOpen, redraw };
  }, [nodeSize, onOpen, redraw]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let gesture: Gesture = { mode: "idle" };
    const hitTest = (point: Point) =>
      nodeAt(layout.current.nodes, toWorld(camera.current, point), latest.current.nodeSize, camera.current.k);

    // PRESS: start dragging a dot, or panning
    const onDown = (event: PointerEvent) => {
      const point = localPoint(element, event);
      const node = hitTest(point);
      element.setPointerCapture(event.pointerId);
      isAutoFit.current = false;
      if (!node) {
        gesture = { mode: "pan", last: point };
        return;
      }
      gesture = { mode: "drag", node, start: point };
      node.fx = node.x;
      node.fy = node.y;
      layout.current.simulation?.alphaTarget(DRAG_ALPHA_TARGET).restart();
    };

    // MOVE: drag, pan, or update the hover focus
    const onMove = (event: PointerEvent) => {
      const point = localPoint(element, event);
      if (gesture.mode === "drag") {
        const world = toWorld(camera.current, point);
        gesture.node.fx = world.x;
        gesture.node.fy = world.y;
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

    // RELEASE: a short press on a dot opens it; a dragged dot is let go
    const onUp = (event: PointerEvent) => {
      const point = localPoint(element, event);
      if (gesture.mode === "drag") {
        const { node, start } = gesture;
        node.fx = null;
        node.fy = null;
        layout.current.simulation?.alphaTarget(0);
        if (Math.hypot(point.x - start.x, point.y - start.y) < CLICK_SLOP_PX) latest.current.onOpen(node);
      }
      gesture = { mode: "idle" };
    };

    // WHEEL: zoom around the cursor (non-passive so the page does not scroll)
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      isAutoFit.current = false;
      camera.current = zoomAt(camera.current, localPoint(element, event), event.deltaY);
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
    element.addEventListener("pointerleave", onLeave);
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointerleave", onLeave);
      element.removeEventListener("wheel", onWheel);
    };
  }, [canvas, layout, camera, hoveredId, isAutoFit]);
}
