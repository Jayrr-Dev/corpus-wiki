import type { GraphColor, GraphDisplay, GraphNode } from "@/lib/graph";
import { type Camera, labelOpacity } from "@/lib/graph/camera";
import { nodeRadius, type SimLink, type SimNode } from "@/lib/graph/physics";
import type { CanvasPalette } from "./palette";

// =====================================================================
// DRAW GRAPH: paints one frame on a 2D canvas, in three passes: links,
// dots, labels. Links share one path per style so 5,000 lines are a few
// draw calls. While a dot is hovered, it and its neighbors stay bright
// and the rest dims (Obsidian's hover focus).
// =====================================================================

export interface DrawInput {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  pixelRatio: number;
  camera: Camera;
  nodes: readonly SimNode[];
  links: readonly SimLink[];
  display: GraphDisplay;
  palette: CanvasPalette;
  colorOf: (node: GraphNode) => GraphColor | null;
  hoveredId: string | null;
  focusIds: ReadonlySet<string>;
}

// OPACITY OF EVERYTHING OUTSIDE THE HOVER FOCUS
const DIMMED = 0.15;
// LABEL SIZE IN SCREEN PIXELS (labels stay readable at any zoom)
const LABEL_PX = 12;
// LINK WIDTH IN SCREEN PIXELS AT THICKNESS 1
const LINK_PX = 0.8;

// Default dot color for a node kind (grays only; groups add the accents)
function baseColor(node: GraphNode, palette: CanvasPalette): string {
  if (node.kind === "page") return palette.text;
  if (node.kind === "entity") return palette.faint;
  return palette.muted;
}

// d3 swaps link ends for node objects once the simulation starts
function ends(link: SimLink): [SimNode, SimNode] | null {
  const { source, target } = link;
  return typeof source === "object" && typeof target === "object" ? [source as SimNode, target as SimNode] : null;
}

// One link segment, stopped at the target dot's edge so an arrowhead can sit there
function traceLink(ctx: CanvasRenderingContext2D, source: SimNode, target: SimNode, input: DrawInput): void {
  const sx = source.x ?? 0, sy = source.y ?? 0, tx = target.x ?? 0, ty = target.y ?? 0;
  const length = Math.hypot(tx - sx, ty - sy) || 1;
  const inset = input.display.arrows ? nodeRadius(target, input.display.nodeSize) : 0;
  const ex = tx - ((tx - sx) / length) * inset, ey = ty - ((ty - sy) / length) * inset;
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  if (!input.display.arrows) return;
  // Arrowhead: two short strokes back from the tip
  const size = 4 / Math.sqrt(input.camera.k);
  const angle = Math.atan2(ty - sy, tx - sx);
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - size * Math.cos(angle - 0.45), ey - size * Math.sin(angle - 0.45));
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - size * Math.cos(angle + 0.45), ey - size * Math.sin(angle + 0.45));
}

// LINKS PASS: plain links in one path; with a hover, focused links in a second, brighter path
function drawLinks(input: DrawInput): void {
  const { ctx, links, palette, hoveredId, camera, display } = input;
  const isFocused = (source: SimNode, target: SimNode) => hoveredId !== null && (source.id === hoveredId || target.id === hoveredId);
  ctx.lineWidth = (LINK_PX * display.linkThickness) / camera.k;
  for (const focused of [false, true]) {
    ctx.beginPath();
    for (const link of links) {
      const pair = ends(link);
      if (pair && isFocused(...pair) === focused) traceLink(ctx, pair[0], pair[1], input);
    }
    ctx.strokeStyle = focused ? palette.muted : palette.border;
    ctx.globalAlpha = focused || hoveredId === null ? 1 : DIMMED;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// DOTS PASS: group color first, else the kind's gray
function drawNodes(input: DrawInput): void {
  const { ctx, nodes, palette, colorOf, hoveredId, focusIds, display } = input;
  for (const node of nodes) {
    const group = colorOf(node);
    ctx.globalAlpha = hoveredId === null || focusIds.has(node.id) ? 1 : DIMMED;
    ctx.fillStyle = group ? palette.token(group) : baseColor(node, palette);
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, nodeRadius(node, display.nodeSize), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// True when a world point is on screen (labels off screen are skipped)
function isOnScreen(node: SimNode, input: DrawInput): boolean {
  const sx = (node.x ?? 0) * input.camera.k + input.camera.x;
  const sy = (node.y ?? 0) * input.camera.k + input.camera.y;
  return sx > -200 && sx < input.width + 200 && sy > -20 && sy < input.height + 20;
}

// LABELS PASS: faded in by zoom; the hover focus always shows its labels
function drawLabels(input: DrawInput): void {
  const { ctx, nodes, palette, camera, display, hoveredId, focusIds } = input;
  const zoomOpacity = labelOpacity(camera.k, display.textFadeThreshold);
  ctx.font = `${LABEL_PX / camera.k}px ${palette.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = palette.muted;
  for (const node of nodes) {
    const inFocus = hoveredId !== null && focusIds.has(node.id);
    const opacity = inFocus ? 1 : hoveredId === null ? zoomOpacity : zoomOpacity * DIMMED;
    if (opacity <= 0.01 || !isOnScreen(node, input)) continue;
    ctx.globalAlpha = opacity;
    const below = nodeRadius(node, display.nodeSize) + 3 / camera.k;
    ctx.fillText(node.label, node.x ?? 0, (node.y ?? 0) + below);
  }
  ctx.globalAlpha = 1;
}

// FRAME: clear, move into world space, then the three passes
export function drawGraph(input: DrawInput): void {
  const { ctx, width, height, pixelRatio, camera, palette } = input;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);
  ctx.setTransform(pixelRatio * camera.k, 0, 0, pixelRatio * camera.k, pixelRatio * camera.x, pixelRatio * camera.y);
  drawLinks(input);
  drawNodes(input);
  drawLabels(input);
}
