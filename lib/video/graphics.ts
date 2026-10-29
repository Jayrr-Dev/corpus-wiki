import type { Scene } from "./types";

// =====================================================================
// SCENE GRAPHICS: one generated illustration per scene, drawn at Make
// video after voicing, in one flat style that matches the scene templates
// (warm off-white page, ink, one blue accent). Every outside call goes
// through GraphicClient; lib/video/server.ts wires the OpenRouter image
// model and tests pass a fake. A graphic is decoration: one that fails is
// left out and the scene shows its text alone, the video still renders.
// =====================================================================

export type Graphic = { bytes: Uint8Array; mime: string; extension: string };

export interface GraphicClient {
  draw(prompt: string): Promise<Graphic>;
}

// The house style every scene shares, so a video looks like one piece
const STYLE = "Flat editorial illustration, simple rounded shapes, soft shadows, a warm off-white background (#faf9f6), dark ink (#1c1b19) and one blue accent (#2563eb), plenty of empty space, the subject centred. No text, letters, numbers, labels, logos or watermarks.";

// Scenes that get a graphic: not a diagram (its boxes are the picture) and not one showing an Assets image
export const wantsGraphic = (scene: Scene) => scene.visual !== "diagram" && !scene.assetId;

// What the image model is asked for: the Narrator's description, or the scene's title and points
export function graphicPrompt(scene: Scene, videoTitle: string): string {
  const subject = scene.graphic?.trim() || [scene.title, ...scene.bullets.slice(0, 3)].join(". ");
  return `${STYLE} Subject, for a video about "${videoTitle}": ${subject}`;
}

// Draws every scene that wants a graphic and has none yet; saves each as it lands (so Try again does not
// pay twice) and keeps going past one that fails
export async function drawScenes(input: {
  scenes: readonly Scene[];
  videoTitle: string;
  client: GraphicClient;
  save: (scene: Scene, graphic: Graphic) => Promise<string>;
  onScene?: (scenes: Scene[]) => Promise<void>;
}): Promise<Scene[]> {
  const scenes = input.scenes.map((scene) => ({ ...scene }));
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index]!;
    if (!wantsGraphic(scene) || scene.graphicPath) continue;
    try {
      const graphic = await input.client.draw(graphicPrompt(scene, input.videoTitle));
      scenes[index] = { ...scene, graphicPath: await input.save(scene, graphic) };
    } catch (error) {
      console.error("Scene graphic failed; the scene shows its text alone", { scene: scene.id, error });
      continue;
    }
    await input.onScene?.(scenes.map((item) => ({ ...item })));
  }
  return scenes;
}
