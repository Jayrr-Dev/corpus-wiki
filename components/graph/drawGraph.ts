import { type ClusterCircle, facingEdges, type GraphColor, type GraphDisplay, type GraphNode, routeControls, routeDomains, type RouteCircle, type RoutePoint, straightenRoute, summaryDomains } from "@/lib/graph";
import { type Camera, hierarchyOpacity, labelOpacity, REVEAL_AT, revealOpacity } from "@/lib/graph/camera";
import { nodeRadius, type SimLink, type SimNode } from "@/lib/graph/physics";
import type { CanvasPalette } from "./palette";

// =====================================================================
// DRAW GRAPH: paints one frame on a 2D canvas, back to front: domain
// circles, links, dots, circle names, note labels. Links share one path per style so 5,000 lines are a few
// draw calls. While a dot is focused (clicked), it and its neighbors stay
// bright and the rest fades out by focusMix, so the dimming eases in and out.
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
  palette: CanvasPalette;
  colorOf: (node: GraphNode) => GraphColor | null;
  // The focused (clicked) dot, and how far the rest has faded for it (0 none, 1 fully dimmed)
  focusId: string | null;
  focusMix?: number;
  focusIds: ReadonlySet<string>;
  // The dot under the pointer: its title shows on a box, nothing dims
  hoveredId?: string | null;
  // While focused, show only the focused dot's text (no neighbor or circle names); its links and neighbors still light up
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

function inDomain(node: GraphNode, domain: string | null | undefined): boolean {
  return !domain || node.domainPaths.some((path) => path === domain || path.startsWith(`${domain}/`));
}

// OPACITY OF EVERYTHING OUTSIDE THE FOCUS: dots and titles, links, and domain circles not holding the focus
const DIMMED = 0.06;
const DIMMED_LINK = 0.12;
const DIMMED_CIRCLE = 0.25;

// Opacity between its resting value and its focused value, by how far the focus has faded in
function faded(input: DrawInput, rest: number, focused: number): number {
  const mix = input.focusId === null ? 0 : (input.focusMix ?? 1);
  return rest + (focused - rest) * mix;
}

// How much a domain circle dims for the focus: circles holding the focused dot stay bright
function circleDim(input: DrawInput, circle: ClusterCircle): number {
  const node = input.focusId === null ? undefined : input.nodes.find((candidate) => candidate.id === input.focusId);
  const holdsFocus = node?.domainPaths.some((path) => path === circle.key || path.startsWith(`${circle.key}/`));
  return holdsFocus ? 1 : faded(input, 1, DIMMED_CIRCLE);
}
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
// HIERARCHICAL BUNDLES: Holten's beta (0 straight, 1 hugs the domain tree)
const BUNDLE_STRENGTH = 0.85;
// DOMAIN SUMMARY LINES: opacity, and the widest one in screen pixels (width grows with the square
// root of the links summed, so one heavy pair cannot drown the rest)
const SUMMARY_ALPHA = 0.45;
const SUMMARY_MAX_PX = 10;
// How far a summary line reaches inside each circle past its edge, in screen pixels
const SUMMARY_TUCK_PX = 12;
// DOMAIN CIRCLES: accent per domain (cycled), fill and ring opacity, ring width and label size in screen pixels
const CIRCLE_COLORS: readonly GraphColor[] = ["link", "applied", "needs-you", "stale", "failed"];
const CIRCLE_FILL_ALPHA = 0.16;
const CIRCLE_RING_ALPHA = 0.8;
const CIRCLE_RING_PX = 1.2;
// Domain names shrink by level: the top level is the biggest, then each level down is smaller, down to the smallest
const CIRCLE_LABEL_PX = { top: 20, step: 3, smallest: 12 } as const;
const CIRCLE_LABEL_HALO_PX = 3;
// How far a domain name's color is pulled toward the text color (darker in light mode, lighter in dark mode)
const CIRCLE_LABEL_CONTRAST = 0.5;

function circleLabelPx(depth: number): number {
  return Math.max(CIRCLE_LABEL_PX.smallest, CIRCLE_LABEL_PX.top - CIRCLE_LABEL_PX.step * depth);
}

// Blend two #rrggbb colors; anything else comes back as the first color unchanged
function mixHex(color: string, toward: string, amount: number): string {
  const parse = (hex: string) => /^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : null;
  const [from, to] = [parse(color), parse(toward)];
  if (!from || !to) return color;
  return `#${from.map((value, i) => Math.round(value + (to[i]! - value) * amount).toString(16).padStart(2, "0")).join("")}`;
}

// Paint text in screen space. Canvas clamps enormous world-space font sizes
// (10,000px in Chrome), making labels vanish at very small overview scales.
// `halo` is the outline width in screen pixels (0 = none), stroked in the current strokeStyle.
function paintText(input: DrawInput, text: string, x: number, y: number, size = LABEL_PX, weight = "", halo = 0): void {
  const { ctx, camera, pixelRatio, palette } = input;
  ctx.save();
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.font = `${weight ? `${weight} ` : ""}${size}px ${palette.fontFamily}`;
  const sx = x * camera.k + camera.x, sy = y * camera.k + camera.y;
  if (halo > 0) { ctx.lineWidth = halo; ctx.lineJoin = "round"; ctx.strokeText(text, sx, sy); }
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

// One link, stopped at the target dot's edge so an arrowhead can sit there. With control points it
// curves through them (a quadratic from midpoint to midpoint, the smooth look of Holten's B-splines).
function traceLink(ctx: CanvasRenderingContext2D, source: SimNode, target: SimNode, input: DrawInput, points: readonly RoutePoint[] = []): void {
  const sx = source.x ?? 0, sy = source.y ?? 0, tx = target.x ?? 0, ty = target.y ?? 0;
  // The last bend sets the direction the link arrives from
  const before = points.length > 2 ? points[points.length - 2]! : { x: sx, y: sy };
  const length = Math.hypot(tx - before.x, ty - before.y) || 1;
  const inset = input.display.arrows ? nodeRadius(target, input.display.nodeSize) : 0;
  const ex = tx - ((tx - before.x) / length) * inset, ey = ty - ((ty - before.y) / length) * inset;
  ctx.moveTo(sx, sy);
  if (points.length > 2) {
    for (let i = 1; i < points.length - 1; i++) {
      const point = points[i]!, next = points[i + 1]!;
      const last = i === points.length - 2;
      ctx.quadraticCurveTo(point.x, point.y, last ? ex : (point.x + next.x) / 2, last ? ey : (point.y + next.y) / 2);
    }
  } else ctx.lineTo(ex, ey);
  if (!input.display.arrows) return;
  // Arrowhead: two short strokes back from the tip
  const size = 4 / Math.sqrt(input.camera.k);
  const angle = Math.atan2(ty - before.y, tx - before.x);
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - size * Math.cos(angle - 0.45), ey - size * Math.sin(angle - 0.45));
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - size * Math.cos(angle + 0.45), ey - size * Math.sin(angle + 0.45));
}

// A summed line between two domains: one per pair, its width grown by how many links it stands for
interface DomainSummary {
  from: RouteCircle;
  to: RouteCircle;
  count: number;
}

// SUMMARY PASS (under the single links): one straight line between the facing edges of each pair
// of domains that links join, faded out as the single links fade in. Edges, not middles: a big
// domain's middle often sits over one of its children, which would look like the line's owner.
function drawSummaries(input: DrawInput, summaries: Iterable<DomainSummary>, shown: number): void {
  const { ctx, palette, camera, display } = input;
  if (shown <= 0.01) return;
  ctx.strokeStyle = palette.muted;
  ctx.lineCap = "round";
  ctx.globalAlpha = SUMMARY_ALPHA * shown * faded(input, 1, 0.5);
  for (const { from, to, count } of summaries) {
    ctx.lineWidth = Math.min(SUMMARY_MAX_PX, LINK_PX * display.linkThickness * (1 + Math.sqrt(count))) / camera.k;
    const [start, end] = facingEdges(from, to, SUMMARY_TUCK_PX / camera.k);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
  ctx.lineCap = "butt";
}

// LINKS PASS: one path per style. Stored links are solid. Derived "similar" links are dashed and
// fainter, hidden at the overview until the camera zooms in, and only drawn inside one domain
// (a guess that spans domains crosses the whole map for little); a hovered dot still shows all of
// its own. Links between domains bundle along the domain tree; at the overview each bundle is
// summed into one line per pair of domains, and the single links fade in as the camera zooms in.
// With a hover, focused links go in a brighter path of their own and are never summed.
function drawLinks(input: DrawInput): void {
  const { ctx, links, palette, focusId, camera, display, circles } = input;
  const isFocused = (source: SimNode, target: SimNode) => focusId !== null && (source.id === focusId || target.id === focusId);
  const centers = new Map<string, RouteCircle>(circles.map((circle) => [circle.key, circle]));
  // Control points for a link, start and end included (none: a straight line)
  const route = (source: SimNode, target: SimNode): RoutePoint[] => {
    if (circles.length === 0) return [];
    const controls = routeControls(source, target, centers);
    return controls.length ? straightenRoute({ x: source.x ?? 0, y: source.y ?? 0 }, controls, { x: target.x ?? 0, y: target.y ?? 0 }, BUNDLE_STRENGTH) : [];
  };
  const similarShown = input.overviewZoom === null ? 1 : revealOpacity(camera.k, input.overviewZoom, REVEAL_AT.similar);
  const isShown = (link: SimLink, source: SimNode, target: SimNode, focused: boolean) =>
    link.kind !== "similar" || focused || routeDomains(source, target).length === 0;
  // How far single links between domains have faded in (1: no summaries)
  const detail = input.overviewZoom === null || circles.length === 0 ? 1 : revealOpacity(camera.k, input.overviewZoom, REVEAL_AT.links);
  // SUMMARIES: stored, unfocused links between two drawn domains, summed per pair
  const summarised = new Set<SimLink>();
  const summaries = new Map<string, DomainSummary>();
  if (detail < 0.99) {
    for (const link of links) {
      const pair = ends(link);
      if (!pair || link.kind === "similar" || isFocused(...pair) || !pair.every((node) => inDomain(node, input.focusedDomain))) continue;
      const domains = summaryDomains(...pair);
      const from = domains && centers.get(domains[0]), to = domains && centers.get(domains[1]);
      if (!domains || !from || !to) continue;
      summarised.add(link);
      const key = [...domains].sort().join("|");
      const summary = summaries.get(key);
      if (summary) summary.count++;
      else summaries.set(key, { from, to, count: 1 });
    }
  }
  drawSummaries(input, summaries.values(), 1 - detail);
  ctx.lineWidth = (LINK_PX * display.linkThickness) / camera.k;
  for (const similar of [true, false]) {
    ctx.setLineDash(similar ? [SIMILAR_DASH_PX / camera.k, SIMILAR_DASH_PX / camera.k] : []);
    for (const focused of [false, true]) {
      const alpha = focused ? faded(input, 0.7, 1) : faded(input, 0.7, DIMMED_LINK);
      const shown = similar && !focused ? alpha * SIMILAR_ALPHA * similarShown : alpha;
      // Links summed at the overview also draw one by one, in a path of their own that fades in with the zoom
      for (const faded of similar || focused ? [false] : [false, true]) {
        const opacity = faded ? shown * detail : shown;
        // Skipping hidden links also skips their routing, the bulk of the cost at the overview
        if (opacity <= 0.01) continue;
        ctx.beginPath();
        for (const link of links) {
          const pair = ends(link);
          if (pair && summarised.has(link) === faded && (link.kind === "similar") === similar && isFocused(...pair) === focused && isShown(link, ...pair, focused) && pair.every((node) => inDomain(node, input.focusedDomain))) traceLink(ctx, pair[0], pair[1], input, route(...pair));
        }
        ctx.strokeStyle = palette.muted;
        ctx.globalAlpha = opacity;
        ctx.stroke();
      }
    }
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

// DOTS PASS: group color first, else the kind's gray
function drawNodes(input: DrawInput): void {
  const { ctx, nodes, palette, colorOf, focusId, focusIds, display } = input;
  for (const node of nodes) {
    const group = colorOf(node);
    ctx.globalAlpha = !inDomain(node, input.focusedDomain) ? 0.08 : focusId === null || focusIds.has(node.id) ? 1 : faded(input, 1, DIMMED);
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

// Opacity of the backing box behind the focused or hovered title (0 = none, 1 = solid canvas colour)
const HOVER_LABEL_BG_ALPHA = 0.95;
// Thick outline around every other title, in screen pixels, so lines and dots behind it do not cut through
const TITLE_HALO_PX = 4;
// Room kept between a title set inside its dot and the dot's edge, in screen pixels
const INSIDE_PAD_PX = 6;

// INSIDE TITLE: the title wrapped to fit inside its dot, or null when the dot is too small on screen.
// The wrap width is rounded so the wrap cache is not refilled on every zoom step.
function insideTitle(ctx: CanvasRenderingContext2D, node: SimNode, input: DrawInput): { lines: string[]; widthPx: number } | null {
  const radiusPx = nodeRadius(node, input.display.nodeSize) * input.camera.k - INSIDE_PAD_PX;
  if (radiusPx < LABEL_PX * 2) return null;
  const wrapPx = Math.min(LABEL_WRAP_PX, Math.floor((radiusPx * 1.6) / 10) * 10);
  const wrapped = wrapLabel(ctx, node.label, wrapPx, input.palette.fontFamily);
  const heightPx = wrapped.lines.length * LABEL_PX * LINE_HEIGHT;
  // The text block's corners must stay inside the circle
  return (wrapped.widthPx / 2) ** 2 + (heightPx / 2) ** 2 <= radiusPx ** 2 ? wrapped : null;
}

// HOVERED LABEL: same wrap as the resting label, on a backing box, nudged inside the canvas so it is never cut off
function drawHoveredLabel(input: DrawInput, node: SimNode, alpha = 1): void {
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
  ctx.globalAlpha = HOVER_LABEL_BG_ALPHA * alpha;
  ctx.fillStyle = palette.background;
  ctx.beginPath();
  ctx.roundRect(boxLeft + shift - pad, y - pad / 2, width + 2 * pad, height + pad, 4 / k);
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = palette.text;
  ctx.textAlign = anchor.align;
  lines.forEach((line, i) => paintText(input, line, x, y + i * lineHeight));
  ctx.globalAlpha = 1;
}

// Opacity of note titles at this zoom (in layers from the overview, or by plain zoom when there is none)
function titleOpacity({ camera, display, overviewZoom }: DrawInput): number {
  return overviewZoom === null
    ? labelOpacity(camera.k, display.textFadeThreshold)
    : revealOpacity(camera.k, overviewZoom, REVEAL_AT.title, display.textFadeThreshold);
}

// LABELS PASS: wrapped, faded in by zoom; the focus shows its labels (or, with hoverLabelOnly,
// only the focused one does), and the focused and hovered labels are drawn last so they sit on top
function drawLabels(input: DrawInput): void {
  const { ctx, nodes, palette, camera, display, focusId, focusIds, hoverLabelOnly } = input;
  const hoveredId = input.hoveredId ?? null;
  const mix = faded(input, 0, 1);
  const hovered = hoveredId === null || hoveredId === focusId ? null : nodes.find((node) => node.id === hoveredId) ?? null;
  ctx.textBaseline = "top";
  if (focusId !== null && hoverLabelOnly) {
    const focused = nodes.find((node) => node.id === focusId);
    if (focused) drawHoveredLabel(input, focused, mix);
    if (hovered) drawHoveredLabel(input, hovered);
    return;
  }
  const zoomOpacity = titleOpacity(input);
  const lineHeight = (LABEL_PX * LINE_HEIGHT) / camera.k;
  ctx.font = `${LABEL_PX}px ${palette.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  let focused: SimNode | null = null;
  for (const node of nodes) {
    if (node.id === focusId) { focused = node; continue; }
    if (node.id === hoveredId) continue;
    if (!inDomain(node, input.focusedDomain)) continue;
    const inFocus = focusId !== null && focusIds.has(node.id);
    const opacity = inFocus ? faded(input, zoomOpacity, 1) : zoomOpacity * faded(input, 1, DIMMED);
    if (opacity <= 0.01 || !isOnScreen(node, input)) continue;
    ctx.globalAlpha = opacity;
    // A dot big enough on screen holds its own title; otherwise the title sits beside it (above by default)
    const inside = insideTitle(ctx, node, input);
    const { lines, widthPx } = inside ?? wrapLabel(ctx, node.label, LABEL_WRAP_PX, palette.fontFamily);
    const { x, y, align } = inside
      ? { x: node.x ?? 0, y: (node.y ?? 0) - (lines.length * lineHeight) / 2, align: "center" as const }
      : titleAnchor(node, lines.length, lineHeight, display, camera.k);
    const left = align === "center" ? x - widthPx / camera.k / 2 : align === "right" ? x - widthPx / camera.k : x;
    if (!reserveLabel(input, left, y, widthPx, lines.length * LABEL_PX * LINE_HEIGHT)) continue;
    // Inside: canvas-coloured text outlined in the dot's own colour. Outside: text outlined in the canvas colour.
    const group = inside ? input.colorOf(node) : null;
    ctx.strokeStyle = inside ? (group ? palette.token(group) : baseColor(node, palette)) : palette.background;
    ctx.fillStyle = inside ? palette.background : palette.text;
    ctx.textAlign = align;
    lines.forEach((line, i) => paintText(input, line, x, y + i * lineHeight, LABEL_PX, "", TITLE_HALO_PX));
  }
  ctx.globalAlpha = 1;
  if (focused) drawHoveredLabel(input, focused, Math.max(mix, zoomOpacity));
  if (hovered) drawHoveredLabel(input, hovered);
}

// CIRCLES PASS (under everything): every domain gets a tinted disc, so the tints stack and deeper
// domains read lighter; domains holding other domains get a solid ring, the innermost a dashed ring
function drawCircles(input: DrawInput): void {
  const { ctx, circles, palette, camera } = input;
  // All parents paint before descendants, including across overlapping roots.
  const ordered = [...circles].sort((a, b) => a.depth - b.depth);
  for (const circle of ordered) {
    // Depth controls the circle paint directly, independently of text/zoom.
    const visibility = Math.max(0.002, 0.18 ** circle.depth);
    const scope = input.focusedDomain && circle.key !== input.focusedDomain && !circle.key.startsWith(`${input.focusedDomain}/`) ? 0.15 : 1;
    const color = palette.token(CIRCLE_COLORS[circle.index % CIRCLE_COLORS.length]!);
    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
    if (circle.depth > 0) {
      // Replace inherited tint with the canvas background, creating a hole.
      ctx.globalAlpha = 1;
      ctx.fillStyle = palette.background;
      ctx.fill();
    }
    ctx.globalAlpha = CIRCLE_FILL_ALPHA * circleDim(input, circle) * visibility * scope;
    ctx.fillStyle = color;
    ctx.fill();
  }
  // Outlines draw after the cutouts, so clearing a child never erases a ring.
  for (const circle of ordered) {
    const color = palette.token(CIRCLE_COLORS[circle.index % CIRCLE_COLORS.length]!);
    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
    ctx.setLineDash(circle.isBranch ? [] : [4 / camera.k, 4 / camera.k]);
    ctx.lineWidth = CIRCLE_RING_PX / camera.k;
    ctx.globalAlpha = CIRCLE_RING_ALPHA * circleDim(input, circle);
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
  const { ctx, circles, palette, camera, focusId, overviewZoom, hoverLabelOnly } = input;
  if (circles.length === 0 || (focusId !== null && hoverLabelOnly)) return;
  // Only the top levels are named at the overview; deeper names fade in as the camera zooms in
  const level = (circle: ClusterCircle) => hierarchyOpacity(circle.depth, camera.k, overviewZoom);
  const titles = overviewZoom === null ? 1 : titleOpacity(input);
  const shown = overviewZoom === null ? 1 : revealOpacity(camera.k, overviewZoom, REVEAL_AT.subdomain);
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.lineWidth = CIRCLE_LABEL_HALO_PX / camera.k;
  ctx.strokeStyle = palette.background;
  // One name at one spot; `place` is "top" (above the ring) or "middle" (across the cluster)
  const name = (circle: ClusterCircle, place: "top" | "middle", alpha: number) => {
    if (input.focusedDomain && circle.key !== input.focusedDomain && !circle.key.startsWith(`${input.focusedDomain}/`)) return;
    if (alpha <= 0.01) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = mixHex(palette.token(CIRCLE_COLORS[circle.index % CIRCLE_COLORS.length]!), palette.text, CIRCLE_LABEL_CONTRAST);
    const fontSize = circleLabelPx(circle.depth);
    const weight = circle.depth < 2 ? "700" : circle.isBranch ? "600" : "500";
    ctx.font = `${weight} ${fontSize}px ${palette.fontFamily}`;
    ctx.textBaseline = place === "top" ? "bottom" : "middle";
    const y = place === "top" ? circle.y - circle.r - 3 / camera.k : circle.y;
    const width = ctx.measureText(circle.label).width;
    const height = fontSize;
    if (!reserveLabel(input, circle.x - width / camera.k / 2, y - (place === "top" ? height : height / 2) / camera.k, width, height)) return;
    input.domainLabelBoxes?.push({path:circle.key,x:circle.x*camera.k+camera.x-width/2,y:y*camera.k+camera.y-(place==="top"?height:height/2),width,height});
    paintText(input, circle.label, circle.x, y, fontSize, weight, CIRCLE_LABEL_HALO_PX);
  };
  // Bigger circles (more notes) claim their name's space first, so a smaller circle's name gives way when they overlap
  for (const circle of [...circles].sort((a, b) => b.r - a.r)) {
    const dim = level(circle) * circleDim(input, circle);
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
