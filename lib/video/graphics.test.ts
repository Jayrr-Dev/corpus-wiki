import { describe, expect, it, vi } from "vitest";
import { drawScenes, type GraphicClient, graphicPrompt, wantsGraphic } from "./graphics";
import { renderSceneTemplate } from "./templates";
import { scene } from "./testing";

const png = { bytes: new Uint8Array([1, 2, 3]), mime: "image/png", extension: "png" };

describe("scene graphics", () => {
  it("draws every scene but diagrams and Assets images, from the Narrator's description", async () => {
    const draw = vi.fn<GraphicClient["draw"]>().mockResolvedValue(png);
    const scenes = [
      scene("a", undefined, { graphic: "a crew member lowering a gas monitor into a manhole" }),
      scene("b", undefined, { visual: "diagram" }),
      scene("c", undefined, { visual: "image", assetId: "asset-1" }),
      scene("d", undefined, { graphicPath: "already/drawn.png" }),
    ];
    const saved: string[] = [];
    const drawn = await drawScenes({ scenes, videoTitle: "Confined spaces", client: { draw }, save: async (item) => { saved.push(item.id); return `g/${item.id}.png`; } });
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw.mock.calls[0]![0]).toContain("a crew member lowering a gas monitor into a manhole");
    expect(draw.mock.calls[0]![0]).toMatch(/No text/);
    expect(saved).toEqual(["a"]);
    expect(drawn.map((item) => item.graphicPath ?? null)).toEqual(["g/a.png", null, null, "already/drawn.png"]);
  });

  it("keeps going past a graphic that fails; that scene shows its text alone", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const draw = vi.fn<GraphicClient["draw"]>().mockRejectedValueOnce(new Error("busy")).mockResolvedValue(png);
      const drawn = await drawScenes({ scenes: [scene("a"), scene("b")], videoTitle: "T", client: { draw }, save: async (item) => `g/${item.id}.png` });
      expect(drawn.map((item) => item.graphicPath ?? null)).toEqual([null, "g/b.png"]);
    } finally { error.mockRestore(); }
  });

  it("falls back to the title and points when the Narrator gave no description", () => {
    expect(graphicPrompt(scene("a", undefined, { title: "Ventilate first", bullets: ["15 minutes"], graphic: null }), "T")).toContain("Ventilate first. 15 minutes");
    expect(wantsGraphic(scene("a", undefined, { visual: "diagram" }))).toBe(false);
  });

  it("puts the text left and the picture right, keeping each visual's heading", () => {
    expect(renderSceneTemplate(scene("a", undefined, { visual: "title", title: "Why test?" }), "graphics/a.png")).toMatch(/with-image.*<h1[^>]*>Why test\?<\/h1>.*<img[^>]*src="graphics\/a.png"/);
    expect(renderSceneTemplate(scene("a", undefined, { visual: "list" }), "graphics/a.png")).toContain("with-image");
    // a diagram keeps its boxes
    expect(renderSceneTemplate(scene("a", undefined, { visual: "diagram", bullets: ["x", "y"] }), "graphics/a.png")).not.toContain("<img");
  });
});
