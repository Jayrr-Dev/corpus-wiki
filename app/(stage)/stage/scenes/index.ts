import type { Scene } from "@/components/video-stage/scene";
import { costs } from "./costs";
import { exception } from "./exception";
import { hello } from "./hello";
import { models } from "./models";
import { picker } from "./picker";

// =====================================================================
// SCENE REGISTRY: /stage/<id> renders SCENES[id]; any other id is a 404.
// Each scene file starts with "use client" and exports one Scene. Add one
// import line and one entry per scene, both in alphabetical order.
// =====================================================================

export const SCENES: Record<string, Scene> = {
  costs,
  exception,
  hello,
  models,
  picker,
};
