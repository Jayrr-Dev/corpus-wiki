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

// Zooms by a wheel delta, keeping the world point under the cursor fixed
export function zoomAt(camera: Camera, screen: Point, wheelDelta: number): Camera {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.k * Math.exp(-wheelDelta * WHEEL_SPEED)));
  const ratio = k / camera.k;
  return { k, x: screen.x - (screen.x - camera.x) * ratio, y: screen.y - (screen.y - camera.y) * ratio };
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
