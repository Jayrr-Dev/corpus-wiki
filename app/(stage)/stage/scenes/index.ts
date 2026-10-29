import type { Scene } from "@/components/video-stage/scene";
import { brent } from "./brent";
import { hello } from "./hello";
import { rewrite } from "./rewrite";
import { settled } from "./settled";
import { page } from "./wiki";

// =====================================================================
// SCENE REGISTRY: /stage/<id> renders SCENES[id]; any other id is a 404.
// Each scene file starts with "use client" and exports one Scene. Add one
// import line and one entry per scene, both in alphabetical order.
// =====================================================================

export const SCENES: Record<string, Scene> = {
  brent,
  hello,
  page,
  rewrite,
  settled,
};
