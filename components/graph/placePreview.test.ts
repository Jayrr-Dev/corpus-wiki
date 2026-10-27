import { expect, it } from "vitest";
import { placePreview, previewView } from "./placePreview";

const view = { x: 0, y: 0, width: 1000, height: 800 };
const card = { width: 300, height: 400 };

it("sits to the right of a dot that has room there", () => {
  const placed = placePreview({ x: 100, y: 400, radius: 10 }, card, view);
  expect(placed.side).toBe("right");
  expect(placed.x).toBe(122);
  expect(placed.y).toBe(200);
});

it("flips to the left when the right side is too small", () => {
  const placed = placePreview({ x: 900, y: 400, radius: 10 }, card, view);
  expect(placed.side).toBe("left");
  expect(placed.x).toBe(578);
  expect(placed.y).toBe(200);
});

it("slides along the dot so the card stays inside the view", () => {
  const placed = placePreview({ x: 500, y: 700, radius: 10 }, card, view);
  expect(placed.side).toBe("right");
  expect(placed.x).toBe(522);
  expect(placed.y).toBe(392);
});

it("keeps the side it already chose while that side still fits", () => {
  const placed = placePreview({ x: 500, y: 400, radius: 10 }, card, view, "left");
  expect(placed.side).toBe("left");
  expect(placed.x).toBe(178);
});

it("picks a new side when the old one no longer fits", () => {
  const placed = placePreview({ x: 950, y: 400, radius: 10 }, card, view, "right");
  expect(placed.side).toBe("left");
});

it("uses the window when the canvas is smaller than the card", () => {
  const canvas = { x: 40, y: 80, width: 200, height: 160 };
  const viewport = { x: 0, y: 0, width: 1200, height: 900 };
  expect(previewView(canvas, card, viewport)).toEqual(viewport);
  expect(previewView({ x: 200, y: 40, width: 900, height: 700 }, card, viewport)).toEqual({ x: 200, y: 40, width: 900, height: 700 });
});
