import { primarySegments } from "./clusters";
import type { GraphNode } from "./types";

// =====================================================================
// HIERARCHICAL EDGE BUNDLES (Holten, 2006): a link between two domains
// bends through the domain circles on the tree path between its ends,
// so links between the same domains share a route and merge into one
// bundle instead of crossing the map one by one. Where the route turns
// (the two sibling domains just below the shared one) it passes through
// the facing edges of those circles, not their middles, so a bundle
// runs in the gap between them instead of across their contents.
// `strength` (Holten's beta) straightens a route back toward a plain
// line: 0 is straight, 1 hugs the tree.
// =====================================================================

export interface RoutePoint {
  x: number;
  y: number;
}

export interface RouteCircle extends RoutePoint {
  r: number;
}

// The route in two legs: up from the source's domain, then down to the target's
interface RouteLegs {
  up: string[];
  down: string[];
}

// Legs per pair of domains (circle keys), cached since every frame asks again
const routeCache = new Map<string, RouteLegs>();
const NO_ROUTE: RouteLegs = { up: [], down: [] };

// Up from the source's domain to just below the lowest shared domain, then down to the target's
// domain. The shared domain itself is left out, so sibling domains bundle without a detour through
// their parent's middle. Empty when both ends sit in the same domain or either end has none.
function routeLegs(source: Pick<GraphNode, "domainPaths">, target: Pick<GraphNode, "domainPaths">): RouteLegs {
  const from = primarySegments(source), to = primarySegments(target);
  if (from.length === 0 || to.length === 0) return NO_ROUTE;
  const key = `${from.join("/")}|${to.join("/")}`;
  const cached = routeCache.get(key);
  if (cached) return cached;
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++;
  const legs: RouteLegs = { up: [], down: [] };
  for (let depth = from.length; depth > shared; depth--) legs.up.push(from.slice(0, depth).join("/"));
  for (let depth = shared + 1; depth <= to.length; depth++) legs.down.push(to.slice(0, depth).join("/"));
  if (routeCache.size > 20_000) routeCache.clear();
  routeCache.set(key, legs);
  return legs;
}

// Domain paths (circle keys) a link between these two dots passes through, in order
export function routeDomains(source: Pick<GraphNode, "domainPaths">, target: Pick<GraphNode, "domainPaths">): string[] {
  const { up, down } = routeLegs(source, target);
  return [...up, ...down];
}

// Point on a circle's edge facing another point
function edgeToward(circle: RouteCircle, other: RoutePoint): RoutePoint {
  const dx = other.x - circle.x, dy = other.y - circle.y;
  const distance = Math.hypot(dx, dy) || 1;
  return { x: circle.x + (dx / distance) * circle.r, y: circle.y + (dy / distance) * circle.r };
}

// Control points a link bends through: circle middles along each leg, and where the legs meet,
// the facing edges of the two sibling circles. Domains without a circle are skipped.
export function routeControls(source: Pick<GraphNode, "domainPaths">, target: Pick<GraphNode, "domainPaths">, circleAt: ReadonlyMap<string, RouteCircle>): RoutePoint[] {
  const { up, down } = routeLegs(source, target);
  const circles = (paths: readonly string[]) => paths.flatMap((path) => circleAt.get(path) ?? []);
  const rising = circles(up), falling = circles(down);
  const turnFrom = up.length && down.length ? rising.pop() : undefined;
  const turnTo = turnFrom ? falling.shift() : undefined;
  if (!turnFrom || !turnTo) return [...rising, ...(turnFrom ? [turnFrom] : []), ...falling];
  return [...rising, edgeToward(turnFrom, turnTo), edgeToward(turnTo, turnFrom), ...falling];
}

// Start, control points and end, each control pulled toward the straight line by 1 - strength
export function straightenRoute(start: RoutePoint, controls: readonly RoutePoint[], end: RoutePoint, strength: number): RoutePoint[] {
  const points = [start, ...controls, end];
  const last = points.length - 1;
  return points.map((point, i) => {
    const t = i / last;
    const lineX = start.x + (end.x - start.x) * t, lineY = start.y + (end.y - start.y) * t;
    return { x: strength * point.x + (1 - strength) * lineX, y: strength * point.y + (1 - strength) * lineY };
  });
}
