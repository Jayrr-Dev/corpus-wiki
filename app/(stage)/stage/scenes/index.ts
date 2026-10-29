import type { Scene } from "@/components/video-stage/scene";
import { glossary } from "./glossary";
import { graph } from "./graph";
import { hello } from "./hello";
import { stakeholders } from "./stakeholders";

// =====================================================================
// SCENE REGISTRY: /stage/<id> renders SCENES[id]; any other id is a 404.
// Each scene file starts with "use client" and exports one Scene. Add one
// import line and one entry per scene, both in alphabetical order.
// =====================================================================

export const SCENES: Record<string, Scene> = {
  glossary,
  graph,
  hello,
  stakeholders,
};
