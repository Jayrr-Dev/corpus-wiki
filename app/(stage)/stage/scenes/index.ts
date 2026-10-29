import type { Scene } from "@/components/video-stage/scene";
import { ask } from "./ask";
import { brent } from "./brent";
import { costs } from "./costs";
import { exception } from "./exception";
import { glossary } from "./glossary";
import { graph } from "./graph";
import { hello } from "./hello";
import { models } from "./models";
import { picker } from "./picker";
import { rewrite } from "./rewrite";
import { settled } from "./settled";
import { stakeholders } from "./stakeholders";
import { upload } from "./upload";
import { video } from "./video";
import { page } from "./wiki";

// =====================================================================
// SCENE REGISTRY: /stage/<id> renders SCENES[id]; any other id is a 404.
// Each scene file starts with "use client" and exports one Scene. Add one
// import line and one entry per scene, both in alphabetical order.
// =====================================================================

export const SCENES: Record<string, Scene> = {
  ask,
  brent,
  costs,
  exception,
  glossary,
  graph,
  hello,
  models,
  page,
  picker,
  rewrite,
  settled,
  stakeholders,
  upload,
  video,
};
