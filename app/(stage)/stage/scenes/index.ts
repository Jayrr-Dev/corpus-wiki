import type { Scene } from "@/components/video-stage/scene";
import { ask } from "./ask";
import { hello } from "./hello";
import { upload } from "./upload";

// =====================================================================
// SCENE REGISTRY: /stage/<id> renders SCENES[id]; any other id is a 404.
// Each scene file starts with "use client" and exports one Scene. Add one
// import line and one entry per scene, both in alphabetical order.
// =====================================================================

export const SCENES: Record<string, Scene> = {
  ask,
  hello,
  upload,
};
