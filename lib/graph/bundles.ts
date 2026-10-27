import { primarySegments } from "./clusters";
import type { GraphNode } from "./types";

// =====================================================================
// HIERARCHICAL EDGE BUNDLES (Holten, 2006): a link between two domains
// bends through the centers of the domain circles on the tree path
// between its ends, so links between the same domains share a route
// and merge into one bundle instead of crossing the map one by one.
// `strength` (Holten's beta) straightens a route back toward a plain
// line: 0 is straight, 1 hugs the tree.
// =====================================================================

export interface RoutePoint {
  x: number;
  y: number;
}

// Domain paths (circle keys) a link between these two dots passes through, cached per pair of domains
const routeCache = new Map<string, string[]>();

// Up from the source's domain to just below the lowest shared domain, then down to the target's
// domain. The shared domain itself is left out, so sibling domains bundle without a detour through
// their parent's middle. Empty when both ends sit in the same domain or either end has none.
export function routeDomains(source: Pick<GraphNode, "domainPaths">, target: Pick<GraphNode, "domainPaths">): string[] {
  const from = primarySegments(source), to = primarySegments(target);
  if (from.length === 0 || to.length === 0) return [];
  const key = `${from.join("/")}|${to.join("/")}`;
  const cached = routeCache.get(key);
  if (cached) return cached;
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++;
  const route: string[] = [];
  for (let depth = from.length; depth > shared; depth--) route.push(from.slice(0, depth).join("/"));
  for (let depth = shared + 1; depth <= to.length; depth++) route.push(to.slice(0, depth).join("/"));
  if (routeCache.size > 20_000) routeCache.clear();
  routeCache.set(key, route);
  return route;
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
