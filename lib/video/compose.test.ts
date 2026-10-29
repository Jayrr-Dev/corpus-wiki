import { describe, expect, it } from "vitest";
import { composeVideo, COMPOSITION_ID, placeScenes, totalDurationMs } from "./compose";
import { escapeHtml, renderSceneTemplate } from "./templates";
import { scene } from "./testing";
import { SCENE_VISUALS } from "./types";

const voiced = (id: string, durationMs: number, extra = {}) => scene(id, `Narration ${id}.`, { audioPath: `x/${id}.mp3`, durationMs, captions: [{ text: "Hello there", startMs: 100, endMs: 900 }], ...extra });

describe("composition", () => {
  it("places scenes back to back from their audio length", () => {
    const placed = placeScenes([voiced("a", 2000), voiced("b", 3500)]);
    expect(placed.map((item) => [item.startMs, item.durationMs, item.audioFile])).toEqual([[0, 2000, "audio/a.mp3"], [2000, 3500, "audio/b.mp3"]]);
    expect(totalDurationMs([voiced("a", 2000), voiced("b", 3500)])).toBe(5500);
  });

  it("refuses a scene that is not voiced", () => {
    expect(() => placeScenes([scene("a")])).toThrow("Scene 1 is not voiced yet.");
  });

  it("writes a HyperFrames composition: scene, audio and caption clips with a paused GSAP timeline", () => {
    const html = composeVideo([voiced("a", 2000), voiced("b", 3500)], { title: "Water <basics>" });
    expect(html).toContain(`data-composition-id="${COMPOSITION_ID}" data-start="0" data-duration="5.500" data-width="1920" data-height="1080"`);
    expect(html).toContain(`<div id="scene-1" class="clip" data-start="2.000" data-duration="3.500" data-track-index="0">`);
    expect(html).toContain(`<audio id="audio-1" class="clip" src="audio/b.mp3" data-start="2.000" data-duration="3.500" data-track-index="1"`);
    expect(html).toContain(`<div id="caption-1-0" class="clip caption" data-start="2.100" data-duration="0.800" data-track-index="2"><span>Hello there</span></div>`);
    expect(html).toContain("gsap.timeline({ paused: true })");
    expect(html).toContain(`window.__timelines["${COMPOSITION_ID}"] = tl;`);
    expect(html).toContain("<title>Water &lt;basics&gt;</title>");
  });

  it("uses an Assets image when the scene has one", () => {
    const html = composeVideo([voiced("a", 1000, { visual: "image", assetId: "asset-1" })], { title: "T", images: { "asset-1": "images/asset-1.png" } });
    expect(html).toContain(`src="images/asset-1.png"`);
  });
});

describe("scene templates", () => {
  it("renders every visual and escapes the text", () => {
    for (const visual of SCENE_VISUALS) {
      const html = renderSceneTemplate(scene("a", "n", { visual, title: "<b>Title</b>", bullets: ["x & y", "z"] }), null);
      expect(html).toContain("&lt;b&gt;Title&lt;/b&gt;");
      expect(html).not.toContain("<b>");
    }
    expect(escapeHtml(`"'&<>`)).toBe("&quot;&#39;&amp;&lt;&gt;");
  });

  it("falls back to a list when an image scene has no image", () => {
    expect(renderSceneTemplate(scene("a", "n", { visual: "image" }), null)).toContain(`class="scene list"`);
  });

  it("draws a diagram as connected boxes", () => {
    const html = renderSceneTemplate(scene("a", "n", { visual: "diagram", bullets: ["Rain", "River", "Sea"] }));
    expect(html.match(/class="node"/g)).toHaveLength(3);
    expect(html.match(/class="arrow"/g)).toHaveLength(2);
  });
});
