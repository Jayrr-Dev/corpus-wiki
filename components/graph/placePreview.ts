// PREVIEW PLACEMENT: keep the node card beside its dot, on a side that
// fits, and slide it back inside the view when the dot nears an edge.

export type Side = "right" | "left" | "bottom" | "top";

export type Rect = { x: number; y: number; width: number; height: number };

const GAP = 12;
const EDGE = 8;
const SIDES: readonly Side[] = ["right", "left", "bottom", "top"];

// The canvas when the card fits in it. The window when the canvas is smaller
// than the card (the local graph), so the card can hang outside that box.
export function previewView(canvas: Rect, card: { width: number; height: number }, viewport: Rect): Rect {
  const fits = canvas.width >= card.width + EDGE * 2 && canvas.height >= card.height + EDGE * 2;
  return fits ? canvas : viewport;
}

// x and y are the card's top-left in the same coordinates as `view`.
export function placePreview(
  anchor: { x: number; y: number; radius: number },
  card: { width: number; height: number },
  view: Rect,
  previous?: Side,
): { x: number; y: number; side: Side } {
  const preferred = previous && fits(previous, anchor, card, view) ? previous : SIDES.find((side) => fits(side, anchor, card, view));
  const side = preferred ?? widest(anchor, card, view);
  const spot = at(side, anchor, card);
  return {
    side,
    x: clamp(spot.x, view.x + EDGE, view.x + view.width - EDGE - card.width),
    y: clamp(spot.y, view.y + EDGE, view.y + view.height - EDGE - card.height),
  };
}

function fits(side: Side, anchor: { x: number; y: number; radius: number }, card: { width: number; height: number }, view: Rect): boolean {
  const spot = at(side, anchor, card);
  if (side === "left" || side === "right") {
    return spot.x >= view.x + EDGE && spot.x + card.width <= view.x + view.width - EDGE;
  }
  return spot.y >= view.y + EDGE && spot.y + card.height <= view.y + view.height - EDGE;
}

function widest(anchor: { x: number; y: number; radius: number }, card: { width: number; height: number }, view: Rect): Side {
  const free = {
    right: view.x + view.width - EDGE - (anchor.x + anchor.radius + GAP),
    left: anchor.x - anchor.radius - GAP - view.x - EDGE,
    bottom: view.y + view.height - EDGE - (anchor.y + anchor.radius + GAP),
    top: anchor.y - anchor.radius - GAP - view.y - EDGE,
  };
  return SIDES.reduce((best, side) => (free[side] > free[best] ? side : best));
}

function at(side: Side, anchor: { x: number; y: number; radius: number }, card: { width: number; height: number }): { x: number; y: number } {
  if (side === "right") return { x: anchor.x + anchor.radius + GAP, y: anchor.y - card.height / 2 };
  if (side === "left") return { x: anchor.x - anchor.radius - GAP - card.width, y: anchor.y - card.height / 2 };
  if (side === "bottom") return { x: anchor.x - card.width / 2, y: anchor.y + anchor.radius + GAP };
  return { x: anchor.x - card.width / 2, y: anchor.y - anchor.radius - GAP - card.height };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
