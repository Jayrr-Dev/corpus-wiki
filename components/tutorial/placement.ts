import type { TargetRect } from "./useTargetRect";

// =====================================================================
// PLACEMENT (pure): where the popover sits next to its target, and
// where its arrow points. Right of targets on the left edge (the
// ribbon), else below when there is room, else above.
// =====================================================================

export const POPOVER_WIDTH = 288; // w-72
const GAP = 12;
const EDGE = 8;
const ROOM_BELOW = 220;
const LEFT_EDGE_TARGET = 120;

export type Side = "right" | "bottom" | "top";
// x = left edge; y = top edge, or for "top" the distance from the viewport bottom; arrowOffset = arrow centre from the left edge
export type Placement = { side: Side; x: number; y: number; arrowOffset: number };

// Popover position for a target in a viewport of the given size
export function placePopover(target: TargetRect, viewport: { width: number; height: number }): Placement {
  const centerX = target.left + target.width / 2;
  const centerY = target.top + target.height / 2;
  if (target.left + target.width < LEFT_EDGE_TARGET) {
    return { side: "right", x: target.left + target.width + GAP, y: centerY, arrowOffset: 0 };
  }
  const left = clamp(centerX - POPOVER_WIDTH / 2, EDGE, viewport.width - POPOVER_WIDTH - EDGE);
  const arrowOffset = clamp(centerX - left, 16, POPOVER_WIDTH - 16);
  const bottomOfTarget = target.top + target.height;
  if (viewport.height - bottomOfTarget >= ROOM_BELOW) {
    return { side: "bottom", x: left, y: bottomOfTarget + GAP, arrowOffset };
  }
  return { side: "top", x: left, y: viewport.height - target.top + GAP, arrowOffset };
}

// Keeps a value inside [min, max]
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
