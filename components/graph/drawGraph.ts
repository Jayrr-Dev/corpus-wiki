import {
  circleNestedIn,
  type ClusterCircle,
  clusterConnections,
  facingEdges,
  type GraphColor,
  type GraphDisplay,
  type GraphGroupBy,
  type GraphNode,
  nodeInCluster,
  ORPHANS_LABEL,
  type RouteCircle,
  routeControls,
  routeDomains,
  type RoutePoint,
  straightenRoute,
  summaryDomains,
} from "@/lib/graph";
import {
  type Camera,
  groupLabelPx,
  hierarchyOpacity,
  labelOpacity,
  REVEAL_AT,
  revealOpacity,
} from "@/lib/graph/camera";
import { GROUPINGS, type GroupingId } from "@/lib/graph/groupings";
import {
  centersGrouping,
  hasHubBody,
  isContent,
  nodeType,
} from "@/lib/graph/nodeTypes";
import { nodeRadius, type SimLink, type SimNode } from "@/lib/graph/physics";
import { recentMarkedKeys, recentUnitIds } from "@/lib/graph/recentUnits";
import type { CanvasPalette } from "./palette";

// =====================================================================
// DRAW GRAPH: paints one frame on a 2D canvas, back to front: domain
// circles, links, dots, circle names, note labels. Links share one path per style so 5,000 lines are a few
// draw calls. While a dot is focused (clicked), it and its neighbors stay
// bright and the rest fades out by focusMix, so the dimming eases in and out.
// Groups fade the same way: a circle stays bright only when it holds the focus
// or a connected dot, or when a selected group links to it.
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
  // The focused (clicked) dot, and how far the rest has faded for it (0 none, 1 fully dimmed)
  focusId: string | null;
  focusMix?: number;
  focusIds: ReadonlySet<string>;
  // The dot under the pointer: its title shows on a box, nothing dims
  hoveredId?: string | null;
  // While focused, show only the focused dot's text (no neighbor or circle names); its links and neighbors still light up
  hoverLabelOnly: boolean;
  domainLabelBoxes?: {
    path: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  focusedDomain?: string | null;
  // Dots and circles a selected circle links to. They stay bright with the selection.
  connectedNodeIds?: ReadonlySet<string>;
  connectedCircleKeys?: ReadonlySet<string>;
  // Circles that hold the focused dot or one of its neighbors. Filled in while drawing.
  litCircleKeys?: ReadonlySet<string>;
  labelBoxes?: { x: number; y: number; w: number; h: number }[];
}

function reserveLabel(
  input: DrawInput,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const box = {
    x: x * input.camera.k + input.camera.x - 8,
    y: y * input.camera.k + input.camera.y - 8,
    w: w + 16,
    h: h + 16,
  };
  if (
    box.x + box.w < 0 ||
    box.y + box.h < 0 ||
    box.x > input.width ||
    box.y > input.height
  )
    return false;
  const boxes = input.labelBoxes ?? [];
  if (
    boxes.some(
      (other) =>
        box.x < other.x + other.w &&
        box.x + box.w > other.x &&
        box.y < other.y + other.h &&
        box.y + box.h > other.y,
    )
  )
    return false;
  boxes.push(box);
  return true;
}

// The grouping whose circle rules apply. With circles off, dots still file by domain.
export function groupingOf(groupBy: GraphGroupBy): GroupingId {
  return groupBy === "off" ? "domain" : groupBy;
}

function circleOutsideFocus(circle: ClusterCircle, input: DrawInput): boolean {
  if (input.connectedCircleKeys?.has(circle.key)) return false;
  const focus = input.focusedDomain;
  if (!focus || circle.key === focus) return false;
  const mode = groupingOf(input.groupBy);
  if (!GROUPINGS[mode].nests) return true;
  const inside = circleNestedIn(circle.key, focus, mode);
  // Page only: a selected section keeps its article lit
  if (mode === "page")
    return !inside && !circleNestedIn(focus, circle.key, mode);
  return !inside;
}

// A dot stays visible when it sits in the selected circle or a link joins it to that circle
function shownWithGroup(node: GraphNode, input: DrawInput): boolean {
  return (
    inFocusGroup(node, input.focusedDomain, input.groupBy) ||
    (input.connectedNodeIds?.has(node.id) ?? false)
  );
}

// The circle the camera is inside, once that circle fills the view. A clicked group wins.
function groupFillingView(input: DrawInput): string | null {
  if (input.focusedDomain) return input.focusedDomain;
  return circleFillingView(input, 0.55);
}

// Share of the screen a circle must cover before zooming in counts as entering it.
const COALESCE_OPEN_SHARE = 0.55;
// Stay open a little past that, so splitting the dots does not snap the group shut.
const COALESCE_CLOSE_SHARE = 0.35;

// Smallest circle under the camera center that covers `share` of the shorter screen side.
function circleFillingView(
  input: Pick<DrawInput, "camera" | "width" | "height" | "circles">,
  share: number,
  onlyKey?: string,
): string | null {
  const { camera, width, height, circles } = input;
  if (circles.length === 0 || camera.k <= 0) return null;
  const cx = (width / 2 - camera.x) / camera.k;
  const cy = (height / 2 - camera.y) / camera.k;
  const view = Math.min(width, height) / camera.k;
  let best: ClusterCircle | null = null;
  for (const circle of circles) {
    if (onlyKey && circle.key !== onlyKey) continue;
    const dx = cx - circle.x;
    const dy = cy - circle.y;
    if (dx * dx + dy * dy > circle.r * circle.r) continue;
    if (circle.r * 2 < view * share) continue;
    if (!best || circle.r < best.r) best = circle;
  }
  return best?.key ?? null;
}

// Group whose claims should split. A clicked group wins. Otherwise the circle
// that fills the view. `hold` keeps the group open until you zoom further out.
export function openCoalesceGroup(
  input: Pick<
    DrawInput,
    "focusedDomain" | "camera" | "width" | "height" | "circles"
  >,
  hold: string | null,
): string | null {
  if (input.focusedDomain) return input.focusedDomain;
  if (hold && circleFillingView(input, COALESCE_CLOSE_SHARE, hold)) return hold;
  return circleFillingView(input, COALESCE_OPEN_SHARE);
}

// A link belongs to that circle when one end sits in it: inside, coming in, or going out
function linkReachesGroup(
  source: GraphNode,
  target: GraphNode,
  input: DrawInput,
  key: string | null,
): boolean {
  if (!key) return true;
  const mode = groupingOf(input.groupBy);
  return nodeInCluster(source, key, mode) || nodeInCluster(target, key, mode);
}

// A link stays visible inside the selected circle, or when it is the link that reaches a connected dot
function linkTouchesFocus(
  source: GraphNode,
  target: GraphNode,
  input: DrawInput,
): boolean {
  if (!input.focusedDomain) return true;
  const sourceIn = inFocusGroup(source, input.focusedDomain, input.groupBy);
  const targetIn = inFocusGroup(target, input.focusedDomain, input.groupBy);
  if (sourceIn && targetIn) return true;
  const connected = input.connectedNodeIds;
  if (!connected) return false;
  return (
    (sourceIn && connected.has(target.id)) ||
    (targetIn && connected.has(source.id))
  );
}

function inFocusGroup(
  node: GraphNode,
  focus: string | null | undefined,
  groupBy: GraphGroupBy,
): boolean {
  if (!focus) return true;
  return nodeInCluster(node, focus, groupingOf(groupBy));
}

function circlePaint(circle: ClusterCircle, input: DrawInput): string {
  if (
    circle.label === ORPHANS_LABEL &&
    input.focusedDomain &&
    !circleOutsideFocus(circle, input)
  )
    return input.palette.text;
  if (!circle.color && input.groupBy === "domain") {
    const domain = input.nodes.find(
      (node) =>
        centersGrouping(node, "domain") &&
        [...node.domainPaths].sort()[0] === circle.key,
    );
    const shaded = domain ? shadedConnection(domain, input) : null;
    if (shaded) return shaded;
  }
  return input.palette.token(
    circle.color ?? CIRCLE_COLORS[circle.index % CIRCLE_COLORS.length]!,
  );
}

// An uncited, unlinked unit. Selecting the circle it sits in draws it in the text color.
function litOrphan(node: GraphNode, input: DrawInput): boolean {
  return (
    Boolean(input.focusedDomain) &&
    shownWithGroup(node, input) &&
    isContent(node) &&
    node.degree === 0 &&
    !node.recommendedTitle &&
    !node.pageTitles?.length &&
    !node.sourceScopes?.includes("external")
  );
}

// OPACITY OF EVERYTHING OUTSIDE THE FOCUS: dots and titles, links, and domain circles not holding the focus
const DIMMED = 0.06;
const DIMMED_LINK = 0.12;
const DIMMED_CIRCLE = 0.1;
// A group outside a selected group: fill and ring both drop to this share of full strength
const OUTSIDE_GROUP = 0.12;
// Unfocused line opacity at the default slider. Other line alphas scale with the slider from here.
const REST_LINK = 0.7;
// A line that only crosses the circle in view, with neither end in that circle
const CROSSING_LINK = 0.08;

// Opacity between its resting value and its focused value, by how far the focus has faded in
function faded(input: DrawInput, rest: number, focused: number): number {
  const mix = input.focusId === null ? 0 : (input.focusMix ?? 1);
  return rest + (focused - rest) * mix;
}

// Scales a built-in line alpha by the Edges opacity slider. Default 0.7 leaves the alpha unchanged.
function edgeAlpha(input: DrawInput, base: number): number {
  return base * (input.display.edgeOpacity / REST_LINK);
}

// Circles that hold the focused dot or a neighbor. Ancestors count: a note in
// "Enneagram/Type Seven" also lights the Enneagram ring.
function circlesHolding(
  input: DrawInput,
  ids: ReadonlySet<string>,
): Set<string> {
  const mode = groupingOf(input.groupBy);
  const keys = new Set<string>();
  if (ids.size === 0) return keys;
  for (const node of input.nodes) {
    if (!ids.has(node.id)) continue;
    for (const circle of input.circles) {
      if (nodeInCluster(node, circle.key, mode)) keys.add(circle.key);
    }
  }
  return keys;
}

// How much a circle dims for a focused dot. Circles that hold that dot or a
// connected dot stay bright. Every other circle fades with the unconnected dots.
function circleDim(input: DrawInput, circle: ClusterCircle): number {
  if (input.focusId === null) return 1;
  return input.litCircleKeys?.has(circle.key)
    ? 1
    : faded(input, 1, DIMMED_CIRCLE);
}

// Shared fade for a circle's fill, ring, and name. A selected group fades
// every group it does not contain and does not link to.
function circleFocus(input: DrawInput, circle: ClusterCircle): number {
  if (circleOutsideFocus(circle, input)) return OUTSIDE_GROUP;
  return circleDim(input, circle);
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
const CIRCLE_COLORS: readonly GraphColor[] = [
  "link",
  "applied",
  "needs-you",
  "stale",
  "failed",
];
const CIRCLE_FILL_ALPHA = 0.16;
const CIRCLE_RING_ALPHA = 0.8;
const CIRCLE_RING_PX = 1.2;
const NEW_CIRCLE_RING_PX = 3;
// Fullest group name above a ring, in screen pixels. Smaller or emptier circles scale down toward the note title size.
const CIRCLE_LABEL_PX = 32;
// Centered type tracks the circle it sits in: a fraction of the screen radius, clamped.
// A bubble title starts at that size, then shrinks until the whole title fits.
const CENTER_TYPE_RATIO = 0.36;
const INSIDE_LABEL_MAX_PX = 42;
const CIRCLE_CENTER_MAX_PX = 64;
// Once a bubble is this wide on screen, shrink past the note title size before cutting the title.
// A bubble this big also keeps its title even when several groups are still on screen.
const ZOOMED_BUBBLE_PX = 40;
const ZOOMED_LABEL_MIN_PX = 8;
const CIRCLE_LABEL_HALO_PX = 6;
// How far a domain name's color is pulled toward the text color (darker in light mode, lighter in dark mode)
const CIRCLE_LABEL_CONTRAST = 0.82;

// Outline width in screen pixels. Grows with the type so a large name stays separated from the dots under it.
function textHalo(fontPx: number): number {
  return Math.max(CIRCLE_LABEL_HALO_PX, Math.round(fontPx * 0.34));
}

// One design shade is a quarter of the way toward black, or toward white. `steps` repeats that.
const CONNECTION_SHADE_STEPS = 3;

function shadeDarker(color: string, steps: number): string {
  let next = color;
  for (let i = 0; i < steps; i++) next = mixHex(next, "#000000", 0.25);
  return next;
}

function shadeBrighter(color: string, steps: number): string {
  let next = color;
  for (let i = 0; i < steps; i++) next = mixHex(next, "#ffffff", 0.25);
  return next;
}

function colorChannels(color: string): [number, number, number] | null {
  const hex = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const value = hex[1]!;
    return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [
      number,
      number,
      number,
    ];
  }
  const rgb = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (!rgb) return null;
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
}

// A light canvas needs a darker group color. A dark canvas needs a brighter one.
function canvasIsLight(background: string): boolean {
  const rgb = colorChannels(background);
  if (!rgb) return false;
  const [r, g, b] = rgb.map((value) => value / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.6;
}

function shadeForCanvas(color: string, background: string): string {
  return canvasIsLight(background)
    ? shadeDarker(color, CONNECTION_SHADE_STEPS)
    : shadeBrighter(color, CONNECTION_SHADE_STEPS);
}

function otherEnd(
  link: SimLink,
  id: string,
  nodes: readonly SimNode[],
): SimNode | null {
  const source =
    typeof link.source === "object"
      ? link.source
      : nodes.find((node) => node.id === link.source);
  const target =
    typeof link.target === "object"
      ? link.target
      : nodes.find((node) => node.id === link.target);
  if (!source || !target) return null;
  if (source.id === id) return target;
  if (target.id === id) return source;
  return null;
}

function majorityHex(
  nodes: readonly GraphNode[],
  input: DrawInput,
): string | null {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (hasHubBody(node)) continue;
    const token = input.colorOf(node);
    if (!token) continue;
    const hex = input.palette.token(token);
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  let best: string | null = null;
  let count = 0;
  for (const [hex, next] of counts) {
    if (next > count) {
      best = hex;
      count = next;
    }
  }
  return best;
}

// The color of the notes a domain bubble connects to, shifted so it stays readable:
// three shades darker on a light canvas, three shades brighter on a dark one.
function shadedConnection(node: SimNode, input: DrawInput): string | null {
  if (!hasHubBody(node)) return null;
  const linked: SimNode[] = [];
  for (const link of input.links) {
    const other = otherEnd(link, node.id, input.nodes);
    if (other && !hasHubBody(other)) linked.push(other);
  }
  const fromLinks = majorityHex(linked, input);
  if (fromLinks) return shadeForCanvas(fromLinks, input.palette.background);
  const path = [...node.domainPaths].sort()[0];
  if (!path) return null;
  const members = input.nodes.filter(
    (other) => !hasHubBody(other) && nodeInCluster(other, path, "domain"),
  );
  const fromMembers = majorityHex(members, input);
  return fromMembers
    ? shadeForCanvas(fromMembers, input.palette.background)
    : null;
}

// Blend two #rrggbb colors; anything else comes back as the first color unchanged
function mixHex(color: string, toward: string, amount: number): string {
  const parse = (hex: string) =>
    /^#[0-9a-f]{6}$/i.test(hex)
      ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
      : null;
  const [from, to] = [parse(color), parse(toward)];
  if (!from || !to) return color;
  return `#${from
    .map((value, i) =>
      Math.round(value + (to[i]! - value) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

// Paint text in screen space. Canvas clamps enormous world-space font sizes
// (10,000px in Chrome), making labels vanish at very small overview scales.
// `halo` is the outline width in screen pixels (0 = none), stroked in the current strokeStyle.
function paintText(
  input: DrawInput,
  text: string,
  x: number,
  y: number,
  size = LABEL_PX,
  weight = "",
  halo = 0,
): void {
  const { ctx, camera, pixelRatio, palette } = input;
  ctx.save();
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.font = `${weight ? `${weight} ` : ""}${size}px ${palette.fontFamily}`;
  const sx = x * camera.k + camera.x,
    sy = y * camera.k + camera.y;
  if (halo > 0) {
    ctx.lineWidth = halo;
    ctx.lineJoin = "round";
    ctx.strokeText(text, sx, sy);
  }
  ctx.fillText(text, sx, sy);
  ctx.restore();
}

// Default dot color for a node kind (grays only; groups add the accents)
function baseColor(node: GraphNode, palette: CanvasPalette): string {
  return palette[nodeType(node).shade];
}

function nodePaint(node: GraphNode, input: DrawInput): string {
  const group = input.colorOf(node);
  return group ? input.palette.token(group) : baseColor(node, input.palette);
}

// d3 swaps link ends for node objects once the simulation starts
function ends(link: SimLink): [SimNode, SimNode] | null {
  const { source, target } = link;
  return typeof source === "object" && typeof target === "object"
    ? [source as SimNode, target as SimNode]
    : null;
}

// One link, stopped at the target dot's edge so an arrowhead can sit there. With control points it
// curves through them (a quadratic from midpoint to midpoint, the smooth look of Holten's B-splines).
function traceLink(
  ctx: CanvasRenderingContext2D,
  source: SimNode,
  target: SimNode,
  input: DrawInput,
  points: readonly RoutePoint[] = [],
): void {
  const sx = source.x ?? 0,
    sy = source.y ?? 0,
    tx = target.x ?? 0,
    ty = target.y ?? 0;
  // The last bend sets the direction the link arrives from
  const before =
    points.length > 2 ? points[points.length - 2]! : { x: sx, y: sy };
  const length = Math.hypot(tx - before.x, ty - before.y) || 1;
  const inset = input.display.arrows
    ? nodeRadius(target, input.display.nodeSize)
    : 0;
  const ex = tx - ((tx - before.x) / length) * inset,
    ey = ty - ((ty - before.y) / length) * inset;
  ctx.moveTo(sx, sy);
  if (points.length > 2) {
    for (let i = 1; i < points.length - 1; i++) {
      const point = points[i]!,
        next = points[i + 1]!;
      const last = i === points.length - 2;
      ctx.quadraticCurveTo(
        point.x,
        point.y,
        last ? ex : (point.x + next.x) / 2,
        last ? ey : (point.y + next.y) / 2,
      );
    }
  } else ctx.lineTo(ex, ey);
  if (!input.display.arrows) return;
  // Arrowhead: two short strokes back from the tip
  const size = 4 / Math.sqrt(input.camera.k);
  const angle = Math.atan2(ty - before.y, tx - before.x);
  ctx.moveTo(ex, ey);
  ctx.lineTo(
    ex - size * Math.cos(angle - 0.45),
    ey - size * Math.sin(angle - 0.45),
  );
  ctx.moveTo(ex, ey);
  ctx.lineTo(
    ex - size * Math.cos(angle + 0.45),
    ey - size * Math.sin(angle + 0.45),
  );
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
function drawSummaries(
  input: DrawInput,
  summaries: Iterable<DomainSummary>,
  shown: number,
): void {
  const { ctx, palette, camera, display } = input;
  if (shown <= 0.01) return;
  ctx.strokeStyle = palette.muted;
  ctx.lineCap = "round";
  ctx.globalAlpha =
    edgeAlpha(input, SUMMARY_ALPHA) * shown * faded(input, 1, 0.5);
  for (const { from, to, count } of summaries) {
    ctx.lineWidth =
      Math.min(
        SUMMARY_MAX_PX,
        LINK_PX * display.linkThickness * (1 + Math.sqrt(count)),
      ) / camera.k;
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
  const { ctx, links, focusId, camera, display, circles } = input;
  const groupKey = groupFillingView(input);
  const isFocused = (source: SimNode, target: SimNode) =>
    focusId !== null && (source.id === focusId || target.id === focusId);
  const reachesGroup = (source: SimNode, target: SimNode) =>
    linkReachesGroup(source, target, input, groupKey);
  const centers = new Map<string, RouteCircle>(
    circles.map((circle) => [circle.key, circle]),
  );
  // Control points for a link, start and end included (none: a straight line)
  const route = (source: SimNode, target: SimNode): RoutePoint[] => {
    if (circles.length === 0) return [];
    const controls = routeControls(source, target, centers);
    return controls.length
      ? straightenRoute(
          { x: source.x ?? 0, y: source.y ?? 0 },
          controls,
          { x: target.x ?? 0, y: target.y ?? 0 },
          BUNDLE_STRENGTH,
        )
      : [];
  };
  const similarShown =
    input.overviewZoom === null
      ? 1
      : revealOpacity(camera.k, input.overviewZoom, REVEAL_AT.similar);
  const isShown = (
    link: SimLink,
    source: SimNode,
    target: SimNode,
    focused: boolean,
  ) =>
    link.kind !== "similar" ||
    focused ||
    routeDomains(source, target).length === 0;
  // How far single links between domains have faded in (1: no summaries)
  const detail =
    input.overviewZoom === null || circles.length === 0
      ? 1
      : revealOpacity(camera.k, input.overviewZoom, REVEAL_AT.links);
  // SUMMARIES: stored, unfocused links between two drawn domains, summed per pair
  const summarised = new Set<SimLink>();
  const summaries = new Map<string, DomainSummary>();
  if (detail < 0.99) {
    for (const link of links) {
      const pair = ends(link);
      if (
        !pair ||
        link.kind === "similar" ||
        isFocused(...pair) ||
        !linkTouchesFocus(pair[0], pair[1], input) ||
        !reachesGroup(...pair)
      )
        continue;
      const domains = summaryDomains(...pair);
      const from = domains && centers.get(domains[0]),
        to = domains && centers.get(domains[1]);
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
    ctx.setLineDash(
      similar ? [SIMILAR_DASH_PX / camera.k, SIMILAR_DASH_PX / camera.k] : [],
    );
    for (const focused of [false, true]) {
      const rest = input.display.edgeOpacity;
      const alpha = focused
        ? faded(input, rest, 1)
        : faded(input, rest, edgeAlpha(input, DIMMED_LINK));
      const shown =
        similar && !focused ? alpha * SIMILAR_ALPHA * similarShown : alpha;
      // Links summed at the overview also draw one by one, in a path of their own that fades in with the zoom
      for (const crossing of [true, false]) {
        for (const faded of similar || focused || crossing
          ? [false]
          : [false, true]) {
          const opacity = crossing
            ? edgeAlpha(input, CROSSING_LINK)
            : faded
              ? shown * detail
              : shown;
          // Skipping hidden links also skips their routing, the bulk of the cost at the overview
          if (opacity <= 0.01) continue;
          // One path per source-node color so edges match the dots they leave
          const byColor = new Map<
            string,
            Array<{ source: SimNode; target: SimNode; points: RoutePoint[] }>
          >();
          for (const link of links) {
            const pair = ends(link);
            if (
              !pair ||
              summarised.has(link) !== faded ||
              (link.kind === "similar") !== similar ||
              isFocused(...pair) !== focused ||
              !isShown(link, ...pair, focused) ||
              !linkTouchesFocus(pair[0], pair[1], input) ||
              (reachesGroup(...pair) || focused) === crossing
            )
              continue;
            const color = nodePaint(pair[0], input);
            const bucket = byColor.get(color);
            const entry = {
              source: pair[0],
              target: pair[1],
              points: route(...pair),
            };
            if (bucket) bucket.push(entry);
            else byColor.set(color, [entry]);
          }
          ctx.globalAlpha = opacity;
          for (const [color, entries] of byColor) {
            ctx.beginPath();
            for (const entry of entries)
              traceLink(ctx, entry.source, entry.target, input, entry.points);
            ctx.strokeStyle = color;
            ctx.stroke();
          }
        }
      }
    }
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

// Green ring width in screen pixels, so it stays visible at any zoom.
const NEW_UNIT_RING_PX = 2.5;

// DOTS PASS: group color first, else the kind's gray.
// Domain hubs paint after the notes. Circle names paint after the hubs, so a hub does not cover the group title.
// The newest 10% of knowledge units changed, used, moved, or applied keep a green ring.
function drawNodes(input: DrawInput, domainHubs = false): void {
  const { ctx, nodes, palette, colorOf, focusId, focusIds, display, camera } =
    input;
  const mode = groupingOf(input.groupBy);
  const focus = input.focusedDomain;
  const scoped = focus
    ? nodes.filter((node) => nodeInCluster(node, focus, mode))
    : nodes;
  const recentIds =
    domainHubs || !display.showNew ? null : recentUnitIds(scoped);
  for (const node of nodes) {
    const hub = hasHubBody(node);
    if (hub !== domainHubs) continue;
    const shaded = hub ? shadedConnection(node, input) : null;
    const group = hub ? null : colorOf(node);
    ctx.globalAlpha = !shownWithGroup(node, input)
      ? 0.08
      : focusId === null || focusIds.has(node.id)
        ? 1
        : faded(input, 1, DIMMED);
    ctx.fillStyle = shaded
      ? shaded
      : litOrphan(node, input)
        ? palette.text
        : group
          ? palette.token(group)
          : baseColor(node, palette);
    ctx.beginPath();
    ctx.arc(
      node.x ?? 0,
      node.y ?? 0,
      nodeRadius(node, display.nodeSize),
      0,
      Math.PI * 2,
    );
    ctx.fill();
    if (!recentIds?.has(node.id)) continue;
    ctx.strokeStyle = palette.token("graph-emerald");
    ctx.lineWidth = NEW_UNIT_RING_PX / camera.k;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// True when a world point is on screen (labels off screen are skipped)
function isOnScreen(node: SimNode, input: DrawInput): boolean {
  const sx = (node.x ?? 0) * input.camera.k + input.camera.x;
  const sy = (node.y ?? 0) * input.camera.k + input.camera.y;
  return (
    sx > -200 && sx < input.width + 200 && sy > -80 && sy < input.height + 20
  );
}

// Wrapped lines per label, measured once in screen pixels (font size and wrap width
// both scale with zoom, so the line breaks never change). Cleared when it grows large.
const wrapCache = new Map<string, { lines: string[]; widthPx: number }>();

// Greedy word wrap. A hyphenated word that still overflows breaks at the hyphen.
function wrapLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxPx: number,
  fontFamily: string,
  size = LABEL_PX,
  weight = "",
): { lines: string[]; widthPx: number } {
  const key = `${size}|${weight}|${maxPx}|${fontFamily}|${text}`;
  const cached = wrapCache.get(key);
  if (cached) return cached;
  const font = ctx.font;
  ctx.font = `${weight ? `${weight} ` : ""}${size}px ${fontFamily}`;
  const lines: string[] = [];
  let line = "";
  const pushWord = (word: string) => {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxPx) {
      lines.push(line);
      line = word;
    } else line = next;
    if (line.includes("-") && ctx.measureText(line).width > maxPx) {
      const bits = line.split("-");
      let chunk = "";
      const broken: string[] = [];
      for (let i = 0; i < bits.length; i++) {
        const bit = i < bits.length - 1 ? `${bits[i]}-` : bits[i]!;
        const trial = chunk + bit;
        if (chunk && ctx.measureText(trial).width > maxPx) {
          broken.push(chunk);
          chunk = bit;
        } else chunk = trial;
      }
      if (chunk) broken.push(chunk);
      lines.push(...broken.slice(0, -1));
      line = broken.at(-1) ?? "";
    }
  };
  for (const word of text.split(/\s+/).filter(Boolean)) pushWord(word);
  if (line) lines.push(line);
  const result = {
    lines,
    widthPx: Math.max(0, ...lines.map((l) => ctx.measureText(l).width)),
  };
  ctx.font = font;
  if (wrapCache.size > 20_000) wrapCache.clear();
  wrapCache.set(key, result);
  return result;
}

// TITLE ANCHOR: where a wrapped title sits beside its dot (the chosen side): the x its lines align on,
// the top of its first line, and the alignment
function titleAnchor(
  node: SimNode,
  lineCount: number,
  lineHeight: number,
  display: GraphDisplay,
  k: number,
): { x: number; y: number; align: CanvasTextAlign } {
  const x = node.x ?? 0,
    y = node.y ?? 0;
  const gap = nodeRadius(node, display.nodeSize) + 3 / k;
  const height = lineCount * lineHeight;
  switch (display.titlePosition) {
    case "top":
      return { x, y: y - gap - height, align: "center" };
    case "left":
      return { x: x - gap, y: y - height / 2, align: "right" };
    case "right":
      return { x: x + gap, y: y - height / 2, align: "left" };
    default:
      return { x, y: y + gap, align: "center" };
  }
}

// Hover title plate: blurred graph behind the words, a light wash, and a hairline border
const HOVER_LABEL_BLUR_PX = 8;
const HOVER_LABEL_BORDER_PX = 1;
const HOVER_LABEL_BG_ALPHA = 0.62;
const HOVER_LABEL_RADIUS_PX = 4;

let frostCanvas: HTMLCanvasElement | null = null;

function clampBackingRect(
  input: DrawInput,
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } | null {
  const ratio = input.pixelRatio;
  const maxW = Math.round(input.width * ratio);
  const maxH = Math.round(input.height * ratio);
  let left = Math.floor(x * ratio);
  let top = Math.floor(y * ratio);
  let width = Math.ceil(w * ratio);
  let height = Math.ceil(h * ratio);
  if (left < 0) {
    width += left;
    left = 0;
  }
  if (top < 0) {
    height += top;
    top = 0;
  }
  if (left + width > maxW) width = maxW - left;
  if (top + height > maxH) height = maxH - top;
  if (width < 1 || height < 1) return null;
  return { x: left, y: top, w: width, h: height };
}

// Copies the graph under the plate, blurs it, and paints it clipped to the rounded box
function paintBackdropBlur(
  input: DrawInput,
  box: { x: number; y: number; w: number; h: number },
  alpha: number,
): void {
  const { ctx, pixelRatio } = input;
  if (box.w < 1 || box.h < 1 || typeof ctx.getImageData !== "function") return;
  const pad = HOVER_LABEL_BLUR_PX * 3;
  const sample = clampBackingRect(
    input,
    box.x - pad,
    box.y - pad,
    box.w + pad * 2,
    box.h + pad * 2,
  );
  if (!sample) return;
  let image: ImageData;
  try {
    image = ctx.getImageData(sample.x, sample.y, sample.w, sample.h);
  } catch {
    return;
  }
  if (
    typeof image?.width !== "number" ||
    image.width < 1 ||
    image.height < 1 ||
    typeof document === "undefined"
  )
    return;
  frostCanvas ??= document.createElement("canvas");
  if (frostCanvas.width !== image.width) frostCanvas.width = image.width;
  if (frostCanvas.height !== image.height) frostCanvas.height = image.height;
  const off = frostCanvas.getContext("2d");
  if (!off) return;
  off.putImageData(image, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, HOVER_LABEL_RADIUS_PX);
  ctx.clip();
  ctx.filter = `blur(${HOVER_LABEL_BLUR_PX}px)`;
  ctx.globalAlpha = alpha;
  ctx.drawImage(
    frostCanvas,
    sample.x / pixelRatio,
    sample.y / pixelRatio,
    sample.w / pixelRatio,
    sample.h / pixelRatio,
  );
  ctx.restore();
}

function paintHoverPlate(
  input: DrawInput,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha: number,
): void {
  const { ctx, camera, pixelRatio, palette } = input;
  const box = {
    x: x * camera.k + camera.x,
    y: y * camera.k + camera.y,
    w: w * camera.k,
    h: h * camera.k,
  };
  ctx.save();
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  paintBackdropBlur(input, box, alpha);
  ctx.globalAlpha = HOVER_LABEL_BG_ALPHA * alpha;
  ctx.fillStyle = palette.background;
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, HOVER_LABEL_RADIUS_PX);
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = HOVER_LABEL_BORDER_PX;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}
// Room kept between a title set inside its dot and the dot's edge, in screen pixels
const INSIDE_PAD_PX = 6;

// True when a text block's corners stay inside a circle of this screen radius.
// `topPx` is the top of the block, in screen pixels from the circle's center.
// Omit it and the block is checked on the center.
function blockFits(
  widthPx: number,
  heightPx: number,
  radiusPx: number,
  topPx = -heightPx / 2,
): boolean {
  const half = widthPx / 2;
  const bottom = topPx + heightPx;
  return (
    half ** 2 + topPx ** 2 <= radiusPx ** 2 &&
    half ** 2 + bottom ** 2 <= radiusPx ** 2
  );
}

function lineWidth(
  ctx: CanvasRenderingContext2D,
  lines: readonly string[],
): number {
  return Math.max(0, ...lines.map((line) => ctx.measureText(line).width));
}

// Cuts a line so it fits, keeping the first words and ending in "…"
function ellipsize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxPx: number,
): string {
  if (ctx.measureText(text).width <= maxPx) return text;
  let end = text.length;
  while (end > 0) {
    const kept = text.slice(0, end).trimEnd();
    if (kept && ctx.measureText(`${kept}…`).width <= maxPx) return `${kept}…`;
    end -= 1;
  }
  return "";
}

function typeWeight(size: number, weighted: boolean): string {
  if (!weighted) return "";
  if (size >= 24) return "700";
  if (size >= 18) return "600";
  return "500";
}

// A cut this short is just an ellipsis with a stub ("Typ…"). Leave the title off the dot.
const MIN_CUT_CHARS = 10;

function wholeLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  radiusPx: number,
  fontFamily: string,
  size: number,
  weight: string,
  wrapPx: number,
): { lines: string[]; widthPx: number } | null {
  ctx.font = `${weight ? `${weight} ` : ""}${size}px ${fontFamily}`;
  const wrapped = wrapLabel(ctx, text, wrapPx, fontFamily, size, weight);
  if (wrapped.lines.length === 0) return null;
  const heightPx = wrapped.lines.length * size * LINE_HEIGHT;
  if (!blockFits(wrapped.widthPx, heightPx, radiusPx)) return null;
  return wrapped;
}

type FittedLabel = {
  lines: string[];
  widthPx: number;
  fontPx: number;
  weight: string;
};

// Words that fit at one type size. A cut keeps the start. A stub that short is left off.
function labelAtSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  radiusPx: number,
  fontFamily: string,
  size: number,
  weight: string,
  wrapPx: number,
): FittedLabel | null {
  const whole = wholeLabel(
    ctx,
    text,
    radiusPx,
    fontFamily,
    size,
    weight,
    wrapPx,
  );
  if (whole) return { ...whole, fontPx: size, weight };
  ctx.font = `${weight ? `${weight} ` : ""}${size}px ${fontFamily}`;
  const wrapped = wrapLabel(ctx, text, wrapPx, fontFamily, size, weight);
  const lines = prefixThatFits(ctx, wrapped.lines, radiusPx, wrapPx, size);
  if (!lines) return null;
  const kept = lines.join("").replaceAll("…", "").trim();
  if (lines.some((line) => line.includes("…")) && kept.length < MIN_CUT_CHARS)
    return null;
  return { lines, widthPx: lineWidth(ctx, lines), fontPx: size, weight };
}

// Centered label. Type grows with the circle, between minPx and maxPx.
// `holdSize` keeps that size and cuts extra words. Otherwise the type shrinks
// until the whole title fits, and an ellipsis is only used at minPx.
function fitLabelInCircle(
  ctx: CanvasRenderingContext2D,
  text: string,
  radiusPx: number,
  fontFamily: string,
  minPx: number,
  maxPx: number,
  weighted: boolean,
  holdSize = false,
): FittedLabel | null {
  if (radiusPx < minPx * 0.6) return null;
  const start = Math.round(
    Math.min(maxPx, Math.max(minPx, radiusPx * CENTER_TYPE_RATIO)),
  );
  const floor = Math.round(minPx);
  const wrapPx = Math.max(24, Math.round((radiusPx * 1.6) / 8) * 8);
  if (holdSize)
    return labelAtSize(
      ctx,
      text,
      radiusPx,
      fontFamily,
      start,
      typeWeight(start, weighted),
      wrapPx,
    );
  let low = floor;
  let high = start;
  let best: FittedLabel | null = null;
  while (low <= high) {
    const size = Math.floor((low + high) / 2);
    const whole = wholeLabel(
      ctx,
      text,
      radiusPx,
      fontFamily,
      size,
      typeWeight(size, weighted),
      wrapPx,
    );
    if (whole) {
      best = { ...whole, fontPx: size, weight: typeWeight(size, weighted) };
      low = size + 1;
    } else high = size - 1;
  }
  if (best) return best;
  return labelAtSize(
    ctx,
    text,
    radiusPx,
    fontFamily,
    floor,
    typeWeight(floor, weighted),
    wrapPx,
  );
}

// The first lines that fit. A cut title keeps the start and marks the cut with "…".
function prefixThatFits(
  ctx: CanvasRenderingContext2D,
  lines: readonly string[],
  radiusPx: number,
  wrapPx: number,
  fontPx = LABEL_PX,
): string[] | null {
  const linePx = fontPx * LINE_HEIGHT;
  for (let count = lines.length; count > 0; count -= 1) {
    const cut = count < lines.length;
    let chosen = lines.slice(0, count);
    if (cut) {
      const last = chosen[count - 1] ?? "";
      const fitted = ellipsize(ctx, last, wrapPx);
      if (!fitted) continue;
      const marked = fitted.endsWith("…")
        ? fitted
        : ellipsize(ctx, `${fitted}…`, wrapPx);
      if (!marked) continue;
      chosen = [...chosen.slice(0, -1), marked];
    }
    if (blockFits(lineWidth(ctx, chosen), chosen.length * linePx, radiusPx))
      return chosen;
  }
  const maxWidth =
    2 * Math.sqrt(Math.max(0, radiusPx ** 2 - (linePx / 2) ** 2));
  const line = ellipsize(ctx, lines[0] ?? "", maxWidth);
  if (!line || !blockFits(ctx.measureText(line).width, linePx, radiusPx))
    return null;
  return [line];
}

// Type inside a bubble. Grows with the bubble on screen, and never drops below
// the note title size (the size used when the title sits outside).
function insideFontPx(radiusPx: number): number {
  return Math.round(
    Math.min(
      INSIDE_LABEL_MAX_PX,
      Math.max(LABEL_PX, radiusPx * CENTER_TYPE_RATIO),
    ),
  );
}

// INSIDE TITLE: centered in the bubble. Type starts large, then shrinks until the
// whole title fits. A cut ("…") is only for a bubble that is still too small.
// Once the bubble is large on screen, type may go below the note title size so
// the cut disappears. A stub that short is left off, and the title sits outside.
// Null means the bubble is too small for an inside title.
function insideTitle(
  ctx: CanvasRenderingContext2D,
  node: SimNode,
  input: DrawInput,
): {
  lines: string[];
  widthPx: number;
  topPx: number;
  fontPx: number;
  weight: string;
} | null {
  const radiusPx =
    nodeRadius(node, input.display.nodeSize) * input.camera.k - INSIDE_PAD_PX;
  const zoomed = radiusPx >= ZOOMED_BUBBLE_PX;
  const fitted = fitLabelInCircle(
    ctx,
    node.label,
    radiusPx,
    input.palette.fontFamily,
    zoomed ? ZOOMED_LABEL_MIN_PX : LABEL_PX,
    INSIDE_LABEL_MAX_PX,
    false,
  );
  if (!fitted) return null;
  const kept = fitted.lines.join("").replaceAll("…", "").trim();
  if (
    fitted.lines.some((line) => line.includes("…")) &&
    kept.length < MIN_CUT_CHARS
  )
    return null;
  const heightPx = fitted.lines.length * fitted.fontPx * LINE_HEIGHT;
  return {
    lines: fitted.lines,
    widthPx: fitted.widthPx,
    topPx: -heightPx / 2,
    fontPx: fitted.fontPx,
    weight: fitted.weight,
  };
}

// HOVERED LABEL: same type size as the title in the bubble, sitting above it,
// on a backing box, nudged inside the canvas so it is never cut off
function drawHoveredLabel(input: DrawInput, node: SimNode, alpha = 1): void {
  const { ctx, palette, camera, display } = input;
  const k = camera.k;
  const radiusPx = nodeRadius(node, display.nodeSize) * k - INSIDE_PAD_PX;
  const fontPx = insideFontPx(Math.max(LABEL_PX, radiusPx));
  const wrapPx = Math.min(
    input.width * 0.6,
    Math.max(LABEL_WRAP_PX, (LABEL_WRAP_PX * fontPx) / LABEL_PX),
  );
  const { lines, widthPx } = wrapLabel(
    ctx,
    node.label,
    wrapPx,
    palette.fontFamily,
    fontPx,
  );
  const lineHeight = (fontPx * LINE_HEIGHT) / k;
  const pad = 4 / k;
  const width = widthPx / k;
  const height = lines.length * lineHeight;
  const anchor = titleAnchor(
    node,
    lines.length,
    lineHeight,
    { ...display, titlePosition: "top" },
    k,
  );
  const boxLeft =
    anchor.align === "center"
      ? anchor.x - width / 2
      : anchor.align === "right"
        ? anchor.x - width
        : anchor.x;
  // Keep the box inside the canvas (screen edges converted to world units)
  const margin = LABEL_MARGIN_PX / k;
  const left = -camera.x / k + margin,
    right = (input.width - camera.x) / k - margin;
  const shift =
    Math.min(Math.max(boxLeft, left + pad), right - width - pad) - boxLeft;
  const x = anchor.x + shift,
    y = anchor.y;
  paintHoverPlate(
    input,
    boxLeft + shift - pad,
    y - pad / 2,
    width + 2 * pad,
    height + pad,
    alpha,
  );
  ctx.globalAlpha = alpha;
  ctx.fillStyle = palette.text;
  ctx.textAlign = anchor.align;
  lines.forEach((line, i) =>
    paintText(input, line, x, y + i * lineHeight, fontPx),
  );
  ctx.globalAlpha = 1;
}

// An innermost circle has to cover this much of the view before note titles start to fade in
const INNER_GROUP_FILL = 0.4;

// How much of the view the innermost circle under the camera covers (null when there is no inner circle)
function innerGroupFill(input: DrawInput): number | null {
  const { camera, width, height, circles } = input;
  if (camera.k <= 0) return null;
  const leaves = circles.filter((circle) => !circle.isBranch);
  if (leaves.length === 0) return null;
  const cx = (width / 2 - camera.x) / camera.k;
  const cy = (height / 2 - camera.y) / camera.k;
  const view = Math.min(width, height) / camera.k;
  if (view <= 0) return null;
  let best = 0;
  for (const circle of leaves) {
    const dx = cx - circle.x;
    const dy = cy - circle.y;
    if (dx * dx + dy * dy > circle.r * circle.r) continue;
    best = Math.max(best, (circle.r * 2) / view);
  }
  return best;
}

// Opacity of note titles. They stay hidden while several groups are on screen, and fade in once
// the camera is inside an innermost circle that fills the view.
function titleOpacity(input: DrawInput): number {
  const { camera, display, overviewZoom } = input;
  const zoomed =
    overviewZoom === null
      ? labelOpacity(camera.k, display.textFadeThreshold)
      : revealOpacity(
          camera.k,
          overviewZoom,
          REVEAL_AT.title,
          display.textFadeThreshold,
        );
  const fill = innerGroupFill(input);
  if (fill === null) return zoomed;
  const shown = Math.min(
    1,
    Math.max(0, (fill - INNER_GROUP_FILL) / (INNER_GROUP_FILL * 0.5)),
  );
  return zoomed * shown;
}

// How far the group name should leave the middle of the circle.
// It stays large across the bubbles until a note title is actually drawn there.
function groupNameLift(input: DrawInput, circle: ClusterCircle): number {
  const mode = groupingOf(input.groupBy);
  const zoomed = titleOpacity(input);
  let notes = false;
  for (const node of input.nodes) {
    if (!isOnScreen(node, input)) continue;
    if (!nodeInCluster(node, circle.key, mode)) continue;
    notes = true;
    const radiusPx =
      nodeRadius(node, input.display.nodeSize) * input.camera.k -
      INSIDE_PAD_PX;
    if (radiusPx >= ZOOMED_BUBBLE_PX) return 1;
  }
  return notes ? zoomed : 0;
}

// LABELS PASS: wrapped, faded in by zoom; the focus shows its labels (or, with hoverLabelOnly,
// only the focused one does), and the focused and hovered labels are drawn last so they sit on top
function drawLabels(input: DrawInput): void {
  const {
    ctx,
    nodes,
    palette,
    camera,
    display,
    focusId,
    focusIds,
    hoverLabelOnly,
  } = input;
  const hoveredId = input.hoveredId ?? null;
  const mix = faded(input, 0, 1);
  const hovered =
    hoveredId === null || hoveredId === focusId
      ? null
      : (nodes.find((node) => node.id === hoveredId) ?? null);
  ctx.textBaseline = "top";
  if (focusId !== null && hoverLabelOnly) {
    const focused = nodes.find((node) => node.id === focusId);
    if (focused) drawHoveredLabel(input, focused, mix);
    if (hovered) drawHoveredLabel(input, hovered);
    return;
  }
  const zoomOpacity = titleOpacity(input);
  ctx.font = `${LABEL_PX}px ${palette.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  let focused: SimNode | null = null;
  // Bigger dots claim their title first, so a large bubble's title is not dropped behind a small neighbor
  const ordered = [...nodes].sort((a, b) => {
    const byRadius =
      nodeRadius(b, display.nodeSize) - nodeRadius(a, display.nodeSize);
    return byRadius !== 0 ? byRadius : a.id.localeCompare(b.id);
  });
  for (const node of ordered) {
    if (node.id === focusId) {
      focused = node;
      continue;
    }
    if (node.id === hoveredId) continue;
    if (!shownWithGroup(node, input)) continue;
    if (!isOnScreen(node, input)) continue;
    // A dot big enough on screen holds its whole title in the middle.
    // Otherwise the title sits beside it (above by default).
    const inside = insideTitle(ctx, node, input);
    const inFocus = focusId !== null && focusIds.has(node.id);
    // Big bubbles keep their title. Small dots still wait until the camera is inside the group.
    const opacity = inside
      ? faded(input, 1, inFocus ? 1 : DIMMED)
      : inFocus
        ? faded(input, zoomOpacity, 1)
        : zoomOpacity * faded(input, 1, DIMMED);
    if (opacity <= 0.01) continue;
    ctx.globalAlpha = opacity;
    const fontPx = inside?.fontPx ?? LABEL_PX;
    const { lines, widthPx } =
      inside ?? wrapLabel(ctx, node.label, LABEL_WRAP_PX, palette.fontFamily);
    const rowPx = fontPx * LINE_HEIGHT;
    const { x, y, align } = inside
      ? {
          x: node.x ?? 0,
          y: (node.y ?? 0) + inside.topPx / camera.k,
          align: "center" as const,
        }
      : titleAnchor(node, lines.length, rowPx / camera.k, display, camera.k);
    const left =
      align === "center"
        ? x - widthPx / camera.k / 2
        : align === "right"
          ? x - widthPx / camera.k
          : x;
    // A title that would sit on one already drawn is left off, including a title inside a bubble.
    const claimed = reserveLabel(input, left, y, widthPx, lines.length * rowPx);
    if (!claimed) continue;
    // Inside a bubble: dark ink with a thin light rim, so the words stay readable on the colour.
    // Outside: light text with a dark rim, so it stays readable on the canvas.
    ctx.strokeStyle = inside ? palette.text : palette.background;
    ctx.fillStyle = inside ? palette.background : palette.text;
    ctx.textAlign = align;
    lines.forEach((line, i) =>
      paintText(
        input,
        line,
        x,
        y + (i * rowPx) / camera.k,
        fontPx,
        inside?.weight ?? "",
        textHalo(fontPx),
      ),
    );
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
    if (circle.quiet) continue;
    // Depth controls the circle paint directly, independently of text/zoom.
    const visibility = Math.max(0.002, 0.18 ** circle.depth);
    const focus = circleFocus(input, circle);
    const color = circlePaint(circle, input);
    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
    if (circle.depth > 0) {
      // Replace inherited tint with the canvas background, creating a hole.
      ctx.globalAlpha = 1;
      ctx.fillStyle = palette.background;
      ctx.fill();
    }
    ctx.globalAlpha = CIRCLE_FILL_ALPHA * focus * visibility;
    ctx.fillStyle = color;
    ctx.fill();
  }
  // Outlines draw after the cutouts, so clearing a child never erases a ring.
  for (const circle of ordered) {
    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
    ctx.lineWidth = CIRCLE_RING_PX / camera.k;
    ctx.globalAlpha = CIRCLE_RING_ALPHA * circleFocus(input, circle);
    if (circle.quiet) {
      ctx.setLineDash([]);
      ctx.strokeStyle = "#000";
      ctx.stroke();
      continue;
    }
    const color = circlePaint(circle, input);
    ctx.setLineDash(circle.isBranch ? [] : [4 / camera.k, 4 / camera.k]);
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const mode = groupingOf(input.groupBy);
  const focus = input.focusedDomain;
  const dated = (circle: ClusterCircle) =>
    circle.createdAt ? [{ key: circle.key, at: circle.createdAt }] : [];
  const newest = !input.display.showNew
    ? new Set<string>()
    : focus
      ? recentMarkedKeys(
          ordered.flatMap((circle) =>
            circleNestedIn(circle.key, focus, mode) ? dated(circle) : [],
          ),
        )
      : new Set([
          ...recentMarkedKeys(
            ordered.flatMap((circle) =>
              circle.parent === "" ? dated(circle) : [],
            ),
          ),
          ...recentMarkedKeys(
            ordered.flatMap((circle) =>
              circle.parent !== "" ? dated(circle) : [],
            ),
          ),
        ]);
  if (newest.size > 0) {
    ctx.strokeStyle = palette.token("graph-yellow");
    ctx.lineWidth = NEW_CIRCLE_RING_PX / camera.k;
    for (const circle of ordered) {
      if (circle.quiet || !newest.has(circle.key)) continue;
      ctx.beginPath();
      ctx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
      ctx.globalAlpha = CIRCLE_RING_ALPHA * circleFocus(input, circle);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// SUGGESTION BADGE: a small pill above the circle name. Merge is orange; a new article is blue.
function paintSuggestionBadge(
  input: DrawInput,
  x: number,
  titleTop: number,
  alpha: number,
  badge: "Merge" | "New Article",
): void {
  const { ctx, camera, pixelRatio, palette } = input;
  const fontPx = 11;
  ctx.save();
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.font = `600 ${fontPx}px ${palette.fontFamily}`;
  const width = ctx.measureText(badge).width + 12;
  const height = fontPx + 6;
  const left = x * camera.k + camera.x - width / 2;
  const top = titleTop * camera.k + camera.y - height - 4;
  const fill = palette.token(badge === "Merge" ? "needs-you" : "link");
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, height / 2);
  ctx.fill();
  ctx.strokeStyle = shadeDarker(fill, 2);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = palette.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(badge, left + width / 2, top + height / 2);
  ctx.restore();
}

// CIRCLE NAMES PASS (over the dots): a domain holding other domains is named above its ring. An
// innermost domain is named across the middle of its cluster around the overview, and above its ring
// once note titles fade in (the two cross-fade, so the name never sits on the titles). Each name has
// a background-colored outline so it reads over dots and lines.
function drawCircleLabels(input: DrawInput): void {
  const {
    ctx,
    circles,
    palette,
    camera,
    focusId,
    overviewZoom,
    hoverLabelOnly,
  } = input;
  if (circles.length === 0 || (focusId !== null && hoverLabelOnly)) return;
  const maxR = circles.reduce((max, circle) => Math.max(max, circle.r), 0);
  const maxCount = circles.reduce(
    (max, circle) => Math.max(max, circle.count),
    0,
  );
  // Top levels stay named at the overview. Deeper names fade in as the camera zooms in.
  const level = (circle: ClusterCircle) =>
    hierarchyOpacity(circle.depth, camera.k, overviewZoom);
  const shown =
    overviewZoom === null
      ? 1
      : revealOpacity(camera.k, overviewZoom, REVEAL_AT.subdomain);
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.lineWidth = CIRCLE_LABEL_HALO_PX / camera.k;
  ctx.strokeStyle = palette.background;
  // One name at one spot; `place` is "top" (above the ring) or "middle" (across the cluster)
  const name = (
    circle: ClusterCircle,
    place: "top" | "middle",
    alpha: number,
  ) => {
    if (circleOutsideFocus(circle, input)) return;
    if (alpha <= 0.01) return;
    ctx.globalAlpha = alpha;
    // A name across the bubbles is dark ink. A name above the ring stays light, on the canvas.
    const onBubbles = place === "middle";
    ctx.fillStyle = onBubbles
      ? palette.background
      : mixHex(
          circlePaint(circle, input),
          palette.text,
          CIRCLE_LABEL_CONTRAST,
        );
    ctx.strokeStyle = onBubbles ? palette.text : palette.background;
    // Name size follows the circle on screen, then shrinks until the whole name fits.
    const centered =
      place === "middle"
        ? fitLabelInCircle(
            ctx,
            circle.label,
            circle.r * camera.k * 0.88,
            palette.fontFamily,
            LABEL_PX,
            CIRCLE_CENTER_MAX_PX,
            true,
          )
        : null;
    if (place === "middle" && !centered) return;
    const fontSize =
      centered?.fontPx ??
      groupLabelPx(
        circle.r,
        maxR,
        circle.count,
        maxCount,
        LABEL_PX,
        CIRCLE_LABEL_PX,
      );
    const weight = centered?.weight ?? typeWeight(fontSize, true);
    ctx.font = `${weight ? `${weight} ` : ""}${fontSize}px ${palette.fontFamily}`;
    const wrapPx = Math.max(
      fontSize * 5,
      Math.min(circle.r * 2 * camera.k * 0.92, input.width * 0.8),
    );
    const wrapped = centered
      ? null
      : wrapLabel(
          ctx,
          circle.label,
          wrapPx,
          palette.fontFamily,
          fontSize,
          weight,
        );
    const lines = centered?.lines ?? wrapped?.lines ?? [];
    const widthPx = centered?.widthPx ?? wrapped?.widthPx ?? 0;
    const linePx = fontSize * LINE_HEIGHT;
    const badgePx = circle.badge ? 20 : 0;
    const blockPx = lines.length * linePx;
    const pad = 16 / camera.k;
    const viewLeft = -camera.x / camera.k + pad;
    const viewRight = (input.width - camera.x) / camera.k - pad;
    const viewTop = -camera.y / camera.k + pad;
    const viewBottom = (input.height - camera.y) / camera.k - pad;
    // A parent ring's name sits just above the ring. Once that point leaves the
    // screen, pin the name to the top of the part you can still see.
    let anchorX = circle.x;
    let anchorY =
      place === "top" ? circle.y - circle.r - 3 / camera.k : circle.y;
    let baseline: "bottom" | "middle" | "top" =
      place === "top" ? "bottom" : "middle";
    if (place === "top" && (anchorY < viewTop || anchorY > viewBottom)) {
      const spanLeft = Math.max(circle.x - circle.r, viewLeft);
      const spanRight = Math.min(circle.x + circle.r, viewRight);
      anchorX = (spanLeft + spanRight) / 2;
      anchorY = Math.min(Math.max(viewTop, circle.y - circle.r), viewBottom);
      baseline = "top";
    }
    const top =
      baseline === "bottom"
        ? anchorY - blockPx / camera.k
        : baseline === "middle"
          ? anchorY - blockPx / camera.k / 2
          : anchorY;
    if (
      !reserveLabel(
        input,
        anchorX - widthPx / camera.k / 2,
        top - badgePx / camera.k,
        widthPx,
        blockPx + badgePx,
      )
    )
      return;
    input.domainLabelBoxes?.push({
      path: circle.key,
      x: anchorX * camera.k + camera.x - widthPx / 2,
      y: top * camera.k + camera.y,
      width: widthPx,
      height: blockPx,
    });
    ctx.textBaseline = baseline;
    lines.forEach((line, index) => {
      const y =
        baseline === "bottom"
          ? anchorY - ((lines.length - 1 - index) * linePx) / camera.k
          : baseline === "top"
            ? anchorY + (index * linePx) / camera.k
            : anchorY + ((index - (lines.length - 1) / 2) * linePx) / camera.k;
      paintText(
        input,
        line,
        anchorX,
        y,
        fontSize,
        weight,
        textHalo(fontSize),
      );
    });
    if (circle.badge)
      paintSuggestionBadge(input, anchorX, top, alpha, circle.badge);
  };
  // Bigger circles (more notes) claim their name's space first, so a smaller circle's name gives way when they overlap
  for (const circle of [...circles].sort((a, b) => b.r - a.r)) {
    const dim = level(circle) * circleFocus(input, circle);
    if (circle.isBranch) name(circle, "top", dim);
    else {
      const lift = groupNameLift(input, circle);
      name(circle, "middle", dim * Math.min(shown, 1 - lift));
      name(circle, "top", dim * lift);
    }
  }
  ctx.globalAlpha = 1;
}

// FRAME: clear, move into world space, then the passes from back to front
export function drawGraph(input: DrawInput): void {
  const mode = groupingOf(input.groupBy);
  const connected = input.focusedDomain
    ? clusterConnections(
        input.nodes,
        input.links.flatMap((link) => {
          const pair = ends(link);
          return pair ? [{ source: pair[0].id, target: pair[1].id }] : [];
        }),
        input.focusedDomain,
        mode,
      )
    : { nodeIds: new Set<string>(), circleKeys: new Set<string>() };
  input = {
    ...input,
    labelBoxes: [],
    connectedNodeIds: connected.nodeIds,
    connectedCircleKeys: connected.circleKeys,
    litCircleKeys:
      input.focusId === null
        ? undefined
        : circlesHolding(input, input.focusIds),
  };
  const { ctx, width, height, pixelRatio, camera, palette } = input;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);
  ctx.setTransform(
    pixelRatio * camera.k,
    0,
    0,
    pixelRatio * camera.k,
    pixelRatio * camera.x,
    pixelRatio * camera.y,
  );
  drawCircles(input);
  drawLinks(input);
  drawNodes(input);
  drawNodes(input, true);
  drawCircleLabels(input);
  drawLabels(input);
}
