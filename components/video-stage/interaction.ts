import type { CSSProperties } from "react";
import { seg } from "./time";

// =====================================================================
// HOVER AND PRESS ON REAL COMPONENTS: CSS transitions are off on the
// stage, so a scene wraps a component and styles the wrapper from t:
//   <span style={{ display: "inline-block", ...interaction(t, { hover: [1, 2.2], click: 2 }) }}><Button>…</Button></span>
// =====================================================================

// 0..1 press depth around a click: down in 60 ms, back up over 220 ms
export function pressDepth(t: number, clickTime: number): number {
  if (t < clickTime) return seg(t, clickTime - 0.06, clickTime);
  return 1 - seg(t, clickTime, clickTime + 0.22);
}

// 0..1 hover amount: in over 150 ms from a, out over 150 ms from b
export function hoverAmount(t: number, a: number, b: number): number {
  return seg(t, a, a + 0.15) * (1 - seg(t, b, b + 0.15));
}

// Pressed look: a little smaller and darker at the click
export function pressed(t: number, clickTime: number): CSSProperties {
  const depth = pressDepth(t, clickTime);
  return { transform: `scale(${1 - 0.05 * depth})`, filter: `brightness(${1 - 0.15 * depth})`, transformOrigin: "center" };
}

// Hovered look: a little brighter between a and b
export function hovered(t: number, a: number, b: number): CSSProperties {
  return { filter: `brightness(${1 + 0.18 * hoverAmount(t, a, b)})` };
}

// Hover and press together (both set filter, so they can't simply be spread)
export function interaction(t: number, { hover, click }: { hover?: readonly [number, number]; click?: number | readonly number[] }): CSSProperties {
  const clicks = click === undefined ? [] : typeof click === "number" ? [click] : click;
  const depth = Math.max(0, ...clicks.map((c) => pressDepth(t, c)));
  const lift = hover ? hoverAmount(t, hover[0], hover[1]) : 0;
  return { transform: `scale(${1 - 0.05 * depth})`, filter: `brightness(${(1 + 0.18 * lift) * (1 - 0.15 * depth)})`, transformOrigin: "center" };
}
