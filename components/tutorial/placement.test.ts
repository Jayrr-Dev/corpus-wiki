import { describe, expect, it } from "vitest";
import { placePopover } from "./placement";

const VIEWPORT = { width: 1280, height: 800 };

describe("placePopover", () => {
  it("sits right of a ribbon button, level with it, arrow at its centre", () => {
    expect(placePopover({ top: 100, left: 8, width: 32, height: 32 }, VIEWPORT)).toEqual({ side: "right", x: 52, y: 88, arrowOffset: 28 });
  });

  it("stays on screen beside a ribbon button at the very top", () => {
    expect(placePopover({ top: 4, left: 6, width: 32, height: 32 }, VIEWPORT)).toEqual({ side: "right", x: 50, y: 8, arrowOffset: 12 });
  });

  it("sits below a target with room under it, arrow under the target's centre", () => {
    const placement = placePopover({ top: 20, left: 1100, width: 100, height: 28 }, VIEWPORT);
    expect(placement).toMatchObject({ side: "bottom", y: 60, x: 1280 - 288 - 8 });
    expect(placement.x + placement.arrowOffset).toBe(1150);
  });

  it("sits above a target near the bottom of the screen", () => {
    expect(placePopover({ top: 700, left: 400, width: 200, height: 60 }, VIEWPORT)).toMatchObject({ side: "top", y: 112 });
  });
});
