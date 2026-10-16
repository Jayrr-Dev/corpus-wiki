// =====================================================================
// CAMERA: pan and zoom as one transform, screen = world * k + (x, y).
// Pure functions, so the canvas code only stores the current camera.
// =====================================================================

export interface Camera {
  x: number;
  y: number;
  k: number;
}

export interface Point {
  x: number;
  y: number;
}

// ZOOM LIMITS
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
const WHEEL_SPEED = 0.0015;

// Camera centered on the world origin for a canvas of this size
export function centeredCamera(width: number, height: number, k = 1): Camera {
  return { x: width / 2, y: height / 2, k };
}

// Screen point -> world point
export function toWorld(camera: Camera, screen: Point): Point {
  return { x: (screen.x - camera.x) / camera.k, y: (screen.y - camera.y) / camera.k };
}

// Zooms by a scale factor (2 = twice as close), keeping the world point under `screen` fixed
export function zoomBy(camera: Camera, screen: Point, factor: number): Camera {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.k * factor));
  const ratio = k / camera.k;
  return { k, x: screen.x - (screen.x - camera.x) * ratio, y: screen.y - (screen.y - camera.y) * ratio };
}

// Zooms by a wheel delta, keeping the world point under the cursor fixed
export function zoomAt(camera: Camera, screen: Point, wheelDelta: number): Camera {
  return zoomBy(camera, screen, Math.exp(-wheelDelta * WHEEL_SPEED));
}

// PINCH: one frame of a two-finger gesture. The midpoint's movement pans, the change in finger
// distance zooms around the new midpoint, so the world point between the fingers stays under them.
export function pinchStep(camera: Camera, from: { mid: Point; distance: number }, to: { mid: Point; distance: number }): Camera {
  const panned = panBy(camera, to.mid.x - from.mid.x, to.mid.y - from.mid.y);
  return zoomBy(panned, to.mid, to.distance / Math.max(1, from.distance));
}

// Moves the camera by a screen-space drag
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x + dx, y: camera.y + dy };
}

// Label opacity at this zoom: fades in from 2^threshold to 1.5x that (Obsidian's text fade threshold)
export function labelOpacity(zoom: number, threshold: number): number {
  const start = 2 ** threshold;
  return Math.min(1, Math.max(0, (zoom - start) / (start * 0.5)));
}

// PROGRESSIVE ZOOM: how many times the overview zoom (the one that fits the whole graph) each layer
// of text needs before it fades in. Domain names always show; topics come next, then note titles.
export const REVEAL_AT = { subdomain: 0.6, title: 1.4 } as const;

// Keep three levels in the overview; reveal deeper levels gradually on zoom.
export function hierarchyOpacity(depth: number, zoom: number, overviewZoom: number | null): number {
  if (overviewZoom === null || depth < 3) return 1;
  return revealOpacity(zoom, overviewZoom, 1.4 ** (depth - 2));
}

// Opacity for a layer that fades in at `reveal` times the overview zoom (the text fade threshold shifts it)
export function revealOpacity(zoom: number, overviewZoom: number, reveal: number, threshold = 0): number {
  return labelOpacity(zoom / (overviewZoom * reveal), threshold);
}

// FIT: the most a fitted view zooms in (a two-dot graph should not fill the screen)
const MAX_FIT_ZOOM = 2;

// Camera that shows every point with `padding` screen pixels around them
export function fitCamera(points: readonly { x?: number; y?: number }[], width: number, height: number, padding = 40): Camera {
  if (points.length === 0) return centeredCamera(width, height);
  const xs = points.map((point) => point.x ?? 0);
  const ys = points.map((point) => point.y ?? 0);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.min(MAX_FIT_ZOOM, (width - padding * 2) / Math.max(1, maxX - minX), (height - padding * 2) / Math.max(1, maxY - minY));
  return { k, x: width / 2 - ((minX + maxX) / 2) * k, y: height / 2 - ((minY + maxY) / 2) * k };
}
