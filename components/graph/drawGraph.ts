import type { ClusterCircle, GraphColor, GraphDisplay, GraphGroupBy, GraphNode } from "@/lib/graph";
import { nodeInCluster } from "@/lib/graph/clusters";
import { type Camera, labelOpacity, REVEAL_AT, revealOpacity } from "@/lib/graph/camera";
import { nodeRadius, type SimLink, type SimNode } from "@/lib/graph/physics";
import type { CanvasPalette } from "./palette";

// =====================================================================
// DRAW GRAPH: paints one frame on a 2D canvas, back to front: domain
// circles, links, dots, circle names, note labels. Links share one path per style so 5,000 lines are a few
// draw calls. While a dot is hovered, it and its neighbors stay bright
// and the rest dims (Obsidian's hover focus).
// =====================================================================

export interface DrawInput {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  pixelRatio: number;
  camera: Camera;
  // Zoom that fits the whole graph; text appears in layers as the camera zooms past it (null: titles fade by plain zoom)
  overviewZoom: number | null;
  nodes: readonly SimNode[];
  links: readonly SimLink[];
  // Domain and subdomain rings (empty when the circles are off)
  circles: readonly ClusterCircle[];
  display: GraphDisplay;
  groupBy: GraphGroupBy;
  palette: CanvasPalette;
  colorOf: (node: GraphNode) => GraphColor | null;
  hoveredId: string | null;
  focusIds: ReadonlySet<string>;
  // While hovering, show only the hovered dot's text (no neighbor or circle names); its links and neighbors still light up
  hoverLabelOnly: boolean;
  domainLabelBoxes?: {path:string;x:number;y:number;width:number;height:number}[];
  focusedDomain?: string | null;
  labelBoxes?: { x: number; y: number; w: number; h: number }[];
}

function reserveLabel(input: DrawInput, x: number, y: number, w: number, h: number): boolean {
  const box = { x: x * input.camera.k + input.camera.x - 5, y: y * input.camera.k + input.camera.y - 4, w: w + 10, h: h + 8 };
  if (box.x + box.w < 0 || box.y + box.h < 0 || box.x > input.width || box.y > input.height) return false;
  const boxes = input.labelBoxes ?? [];
  if (boxes.some((other) => box.x < other.x + other.w && box.x + box.w > other.x && box.y < other.y + other.h && box.y + box.h > other.y)) return false;
  boxes.push(box);
  return true;
}

function circleOutsideFocus(circle: ClusterCircle, input: DrawInput): boolean {
  if (!input.focusedDomain || circle.key === input.focusedDomain) return false;
  if (input.groupBy === "entity") return true;
  return !circle.key.startsWith(`${input.focusedDomain}/`);
}

function inFocusGroup(node: GraphNode, focus: string | null | undefined, groupBy: GraphGroupBy): boolean {
  if (!focus) return true;
  return nodeInCluster(node, focus, groupBy === "entity" ? "entity" : "domain");
}

function circlePaint(circle: ClusterCircle, palette: CanvasPalette): string {
  return palette.token(circle.color ?? CIRCLE_COLORS[circle.index % CIRCLE_COLORS.length]!);
}

// OPACITY OF EVERYTHING OUTSIDE THE HOVER FOCUS
const DIMMED = 0.15;
// LABEL SIZE IN SCREEN PIXELS (labels stay readable at any zoom)
const LABEL_PX = 12;
// WRAPPED LABELS: max line width, line height and canvas margin, in screen pixels.
// Hover uses the same width so a label does not reflow when the pointer arrives.
const LABEL_WRAP_PX = 130;
const LINE_HEIGHT = 1.3;
const LABEL_MARGIN_PX = 6;
// DERIVED "SIMILAR" LINKS: dash length in screen pixels, and opacity next to stored links
const SIMILAR_DASH_PX = 3;
const SIMILAR_ALPHA = 0.7;
// LINK WIDTH IN SCREEN PIXELS AT THICKNESS 1
const LINK_PX = 0.8;
// DOMAIN CIRCLES: accent per domain (cycled), fill and ring opacity, ring width and label size in screen pixels
const CIRCLE_COLORS: readonly GraphColor[] = ["link", "applied", "needs-you", "stale", "failed"];
const CIRCLE_FILL_ALPHA = 0.16;
const CIRCLE_RING_ALPHA = 0.8;
const CIRCLE_RING_PX = 1.2;
const CIRCLE_LABEL_PX = { branch: 14, leaf: 12 } as const;
const CIRCLE_LABEL_HALO_PX = 3;

// Paint text in screen space. Canvas clamps enormous world-space font sizes
// (10,000px in Chrome), making labels vanish at very small overview scales.
function paintText(input: DrawInput, text: string, x: number, y: number, size = LABEL_PX, weight = "", halo = false): void {
  const { ctx, camera, pixelRatio, palette } = input;
  ctx.save();
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.font = `${weight ? `${weight} ` : ""}${size}px ${palette.fontFamily}`;
  const sx = x * camera.k + camera.x, sy = y * camera.k + camera.y;
  if (halo) { ctx.lineWidth = CIRCLE_LABEL_HALO_PX; ctx.strokeText(text, sx, sy); }
  ctx.fillText(text, sx, sy);
  ctx.restore();
}

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

// LINKS PASS: one path per style. Stored links are solid; derived "similar" links are
// dashed and fainter. With a hover, focused links go in a brighter path of their own.
function drawLinks(input: DrawInput): void {
  const { ctx, links, palette, hoveredId, camera, display } = input;
  const isFocused = (source: SimNode, target: SimNode) => hoveredId !== null && (source.id === hoveredId || target.id === hoveredId);
  ctx.lineWidth = (LINK_PX * display.linkThickness) / camera.k;
  for (const similar of [true, false]) {
    ctx.setLineDash(similar ? [SIMILAR_DASH_PX / camera.k, SIMILAR_DASH_PX / camera.k] : []);
    for (const focused of [false, true]) {
      ctx.beginPath();
      for (const link of links) {
        const pair = ends(link);
        if (pair && (link.kind === "similar") === similar && isFocused(...pair) === focused && pair.every((node) => inFocusGroup(node, input.focusedDomain, input.groupBy))) traceLink(ctx, pair[0], pair[1], input);
      }
      ctx.strokeStyle = palette.muted;
      const alpha = focused ? 1 : hoveredId === null ? 0.7 : 0.45;
      ctx.globalAlpha = similar && !focused ? alpha * SIMILAR_ALPHA : alpha;
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

// DOTS PASS: group color first, else the kind's gray
function drawNodes(input: DrawInput): void {
  const { ctx, nodes, palette, colorOf, hoveredId, focusIds, display } = input;
  for (const node of nodes) {
    const group = colorOf(node);
    ctx.globalAlpha = !inFocusGroup(node, input.focusedDomain, input.groupBy) ? 0.08 : hoveredId === null || focusIds.has(node.id) ? 1 : DIMMED;
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
  return sx > -200 && sx < input.width + 200 && sy > -80 && sy < input.height + 20;
}

// Wrapped lines per label, measured once in screen pixels (font size and wrap width
// both scale with zoom, so the line breaks never change). Cleared when it grows large.
const wrapCache = new Map<string, { lines: string[]; widthPx: number }>();

// Greedy word wrap at LABEL_PX; a single over-long word gets its own line
function wrapLabel(ctx: CanvasRenderingContext2D, text: string, maxPx: number, fontFamily: string): { lines: string[]; widthPx: number } {
  const key = `${maxPx}|${fontFamily}|${text}`;
  const cached = wrapCache.get(key);
  if (cached) return cached;
  const font = ctx.font;
  ctx.font = `${LABEL_PX}px ${fontFamily}`;
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxPx) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  const result = { lines, widthPx: Math.max(0, ...lines.map((l) => ctx.measureText(l).width)) };
  ctx.font = font;
  if (wrapCache.size > 20_000) wrapCache.clear();
  wrapCache.set(key, result);
  return result;
}

// TITLE ANCHOR: where a wrapped title sits beside its dot (the chosen side): the x its lines align on,
// the top of its first line, and the alignment
function titleAnchor(node: SimNode, lineCount: number, lineHeight: number, display: GraphDisplay, k: number): { x: number; y: number; align: CanvasTextAlign } {
  const x = node.x ?? 0, y = node.y ?? 0;
  const gap = nodeRadius(node, display.nodeSize) + 3 / k;
  const height = lineCount * lineHeight;
  switch (display.titlePosition) {
    case "top": return { x, y: y - gap - height, align: "center" };
    case "left": return { x: x - gap, y: y - height / 2, align: "right" };
    case "right": return { x: x + gap, y: y - height / 2, align: "left" };
    default: return { x, y: y + gap, align: "center" };
  }
}

// Opacity of the backing box behind the hovered title (0 = none, 1 = solid canvas colour)
const HOVER_LABEL_BG_ALPHA = 0.95;

// HOVERED LABEL: same wrap as the resting label, on a backing box, nudged inside the canvas so it is never cut off
function drawHoveredLabel(input: DrawInput, node: SimNode): void {
  const { ctx, palette, camera, display } = input;
  const k = camera.k;
  const { lines, widthPx } = wrapLabel(ctx, node.label, LABEL_WRAP_PX, palette.fontFamily);
  const lineHeight = (LABEL_PX * LINE_HEIGHT) / k;
  const pad = 4 / k;
  const width = widthPx / k;
  const height = lines.length * lineHeight;
  const anchor = titleAnchor(node, lines.length, lineHeight, display, k);
  const boxLeft = anchor.align === "center" ? anchor.x - width / 2 : anchor.align === "right" ? anchor.x - width : anchor.x;
  // Keep the box inside the canvas (screen edges converted to world units)
  const margin = LABEL_MARGIN_PX / k;
  const left = -camera.x / k + margin, right = (input.width - camera.x) / k - margin;
  const shift = Math.min(Math.max(boxLeft, left + pad), right - width - pad) - boxLeft;
  const x = anchor.x + shift, y = anchor.y;
  ctx.globalAlpha = HOVER_LABEL_BG_ALPHA;
  ctx.fillStyle = palette.background;
  ctx.beginPath();
  ctx.roundRect(boxLeft + shift - pad, y - pad / 2, width + 2 * pad, height + pad, 4 / k);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.text;
  ctx.textAlign = anchor.align;
  lines.forEach((line, i) => paintText(input, line, x, y + i * lineHeight));
}

// Opacity of note titles at this zoom (in layers from the overview, or by plain zoom when there is none)
function titleOpacity({ camera, display, overviewZoom }: DrawInput): number {
  return overviewZoom === null
    ? labelOpacity(camera.k, display.textFadeThreshold)
    : revealOpacity(camera.k, overviewZoom, REVEAL_AT.title, display.textFadeThreshold);
}

// LABELS PASS: wrapped, faded in by zoom; the hover focus always shows its labels (or, with
// hoverLabelOnly, only the hovered one does), and the hovered label is drawn last so it sits on top
function drawLabels(input: DrawInput): void {
  const { ctx, nodes, palette, camera, display, hoveredId, focusIds, hoverLabelOnly } = input;
  ctx.textBaseline = "top";
  if (hoveredId !== null && hoverLabelOnly) {
    const hovered = nodes.find((node) => node.id === hoveredId);
    if (hovered) drawHoveredLabel(input, hovered);
    return;
  }
  const zoomOpacity = titleOpacity(input);
  const lineHeight = (LABEL_PX * LINE_HEIGHT) / camera.k;
  ctx.font = `${LABEL_PX}px ${palette.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = palette.muted;
  let hovered: SimNode | null = null;
  for (const node of nodes) {
    if (node.id === hoveredId) { hovered = node; continue; }
    if (!inFocusGroup(node, input.focusedDomain, input.groupBy)) continue;
    const inFocus = hoveredId !== null && focusIds.has(node.id);
    const opacity = inFocus ? 1 : hoveredId === null ? zoomOpacity : zoomOpacity * DIMMED;
    if (opacity <= 0.01 || !isOnScreen(node, input)) continue;
    ctx.globalAlpha = opacity;
    const { lines, widthPx } = wrapLabel(ctx, node.label, LABEL_WRAP_PX, palette.fontFamily);
    const { x, y, align } = titleAnchor(node, lines.length, lineHeight, display, camera.k);
    const left = align === "center" ? x - widthPx / camera.k / 2 : align === "right" ? x - widthPx / camera.k : x;
    if (!reserveLabel(input, left, y, widthPx, lines.length * LABEL_PX * LINE_HEIGHT)) continue;
    ctx.textAlign = align;
    lines.forEach((line, i) => paintText(input, line, x, y + i * lineHeight));
  }
  ctx.globalAlpha = 1;
  if (hovered) drawHoveredLabel(input, hovered);
}

// CIRCLES PASS (under everything): every domain gets a tinted disc, so the tints stack and deeper
// domains read lighter; domains holding other domains get a solid ring, the innermost a dashed ring
function drawCircles(input: DrawInput): void {
  const { ctx, circles, palette, camera, hoveredId } = input;
  const dim = hoveredId === null ? 1 : 0.4;
  // All parents paint before descendants, including across overlapping roots.
  const ordered = [...circles].sort((a, b) => a.depth - b.depth);
  for (const circle of ordered) {
    // Depth controls the circle paint directly, independently of text/zoom.
    const visibility = Math.max(0.002, 0.18 ** circle.depth);
    const scope = circleOutsideFocus(circle, input) ? 0.15 : 1;
    const color = circlePaint(circle, palette);
    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
    if (circle.depth > 0) {
      // Replace inherited tint with the canvas background, creating a hole.
      ctx.globalAlpha = 1;
      ctx.fillStyle = palette.background;
      ctx.fill();
    }
    ctx.globalAlpha = CIRCLE_FILL_ALPHA * dim * visibility * scope;
    ctx.fillStyle = color;
    ctx.fill();
  }
  // Outlines draw after the cutouts, so clearing a child never erases a ring.
  for (const circle of ordered) {
    const color = circlePaint(circle, palette);
    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
    ctx.setLineDash(circle.isBranch ? [] : [4 / camera.k, 4 / camera.k]);
    ctx.lineWidth = CIRCLE_RING_PX / camera.k;
    ctx.globalAlpha = CIRCLE_RING_ALPHA;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

// CIRCLE NAMES PASS (over the dots): a domain holding other domains is named above its ring. An
// innermost domain is named across the middle of its cluster around the overview, and above its ring
// once note titles fade in (the two cross-fade, so the name never sits on the titles). Each name has
// a background-colored outline so it reads over dots and lines.
function drawCircleLabels(input: DrawInput): void {
  const { ctx, circles, palette, camera, hoveredId, overviewZoom, hoverLabelOnly } = input;
  if (circles.length === 0 || (hoveredId !== null && hoverLabelOnly)) return;
  // Domain names stay readable independently of ring depth and dot hover.
  const dim = 1;
  const titles = overviewZoom === null ? 1 : titleOpacity(input);
  const shown = overviewZoom === null ? 1 : revealOpacity(camera.k, overviewZoom, REVEAL_AT.subdomain);
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.lineWidth = CIRCLE_LABEL_HALO_PX / camera.k;
  ctx.strokeStyle = palette.background;
  // One name at one spot; `place` is "top" (above the ring) or "middle" (across the cluster)
  const name = (circle: ClusterCircle, place: "top" | "middle", alpha: number) => {
    if (circleOutsideFocus(circle, input)) return;
    if (alpha <= 0.01) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = circlePaint(circle, palette);
    const fontSize = CIRCLE_LABEL_PX[circle.isBranch ? "branch" : "leaf"];
    const weight = circle.isBranch ? "600" : "500";
    ctx.font = `${weight} ${fontSize}px ${palette.fontFamily}`;
    ctx.textBaseline = place === "top" ? "bottom" : "middle";
    const y = place === "top" ? circle.y - circle.r - 3 / camera.k : circle.y;
    const width = ctx.measureText(circle.label).width;
    const height = CIRCLE_LABEL_PX[circle.isBranch ? "branch" : "leaf"];
    if (!reserveLabel(input, circle.x - width / camera.k / 2, y - (place === "top" ? height : height / 2) / camera.k, width, height)) return;
    input.domainLabelBoxes?.push({path:circle.key,x:circle.x*camera.k+camera.x-width/2,y:y*camera.k+camera.y-(place==="top"?height:height/2),width,height});
    paintText(input, circle.label, circle.x, y, fontSize, weight, true);
  };
  for (const circle of circles) {
    if (circle.isBranch) name(circle, "top", dim);
    else {
      name(circle, "middle", dim * Math.min(shown, 1 - titles));
      name(circle, "top", dim * titles);
    }
  }
  ctx.globalAlpha = 1;
}

// FRAME: clear, move into world space, then the passes from back to front
export function drawGraph(input: DrawInput): void {
  input = { ...input, labelBoxes: [] };
  const { ctx, width, height, pixelRatio, camera, palette } = input;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);
  ctx.setTransform(pixelRatio * camera.k, 0, 0, pixelRatio * camera.k, pixelRatio * camera.x, pixelRatio * camera.y);
  drawCircles(input);
  drawLinks(input);
  drawNodes(input);
  drawCircleLabels(input);
  drawLabels(input);
}
