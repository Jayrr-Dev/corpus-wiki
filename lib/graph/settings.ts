import { z } from "zod";
import type { GraphFilters } from "./filters";
import { GRAPH_COLORS, type GraphGroup } from "./groups";

// =====================================================================
// GRAPH SETTINGS: everything the panel controls, with Obsidian-like
// defaults. The slider ranges are data, so the panel renders one row
// per entry instead of hand-writing each slider.
// =====================================================================

export interface GraphDisplay {
  arrows: boolean;
  textFadeThreshold: number;
  nodeSize: number;
  linkThickness: number;
}

export interface GraphForces {
  center: number;
  repel: number;
  link: number;
  linkDistance: number;
}

export interface GraphSettings {
  filters: GraphFilters;
  groups: GraphGroup[];
  display: GraphDisplay;
  forces: GraphForces;
}

// DEFAULTS: units and orphans shown, extra layers off, no groups until the person adds one
export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  filters: { search: "", showEntities: false, showPages: false, showOrphans: true, showRelated: true, relatedness: 0.3 },
  groups: [],
  display: { arrows: false, textFadeThreshold: 0, nodeSize: 1, linkThickness: 1 },
  forces: { center: 0.5, repel: 10, link: 1, linkDistance: 60 },
};

// SLIDER RULES: label, range and step for each numeric setting
export interface SliderRule<K extends string> {
  key: K;
  label: string;
  min: number;
  max: number;
  step: number;
}

export const DISPLAY_SLIDERS: readonly SliderRule<Exclude<keyof GraphDisplay, "arrows">>[] = [
  { key: "textFadeThreshold", label: "Text fade threshold", min: -3, max: 3, step: 0.1 },
  { key: "nodeSize", label: "Node size", min: 0.1, max: 5, step: 0.1 },
  { key: "linkThickness", label: "Link thickness", min: 0.1, max: 5, step: 0.1 },
];

export const FORCE_SLIDERS: readonly SliderRule<keyof GraphForces>[] = [
  { key: "center", label: "Center force", min: 0, max: 1, step: 0.01 },
  { key: "repel", label: "Repel force", min: 0, max: 20, step: 0.1 },
  { key: "link", label: "Link force", min: 0, max: 1, step: 0.01 },
  { key: "linkDistance", label: "Link distance", min: 10, max: 300, step: 1 },
];

const DEFAULT_RELATED = { showRelated: DEFAULT_GRAPH_SETTINGS.filters.showRelated, relatedness: DEFAULT_GRAPH_SETTINGS.filters.relatedness };

// SAVED SETTINGS SCHEMA: anything stored that no longer fits falls back to the default
const colorTokens = GRAPH_COLORS.map((color) => color.token) as [GraphGroup["color"], ...GraphGroup["color"][]];
const settingsSchema = z.object({
  // Fields added later default, so older saved settings keep everything else
  filters: z.object({
    search: z.string(),
    showEntities: z.boolean(),
    showPages: z.boolean(),
    showOrphans: z.boolean(),
    showRelated: z.boolean().default(DEFAULT_RELATED.showRelated),
    relatedness: z.number().default(DEFAULT_RELATED.relatedness),
  }),
  groups: z.array(z.object({ id: z.string(), query: z.string(), color: z.enum(colorTokens) })),
  display: z.object({ arrows: z.boolean(), textFadeThreshold: z.number(), nodeSize: z.number(), linkThickness: z.number() }),
  forces: z.object({ center: z.number(), repel: z.number(), link: z.number(), linkDistance: z.number() }),
});

// Reads saved settings; the defaults when nothing valid was saved
export function parseSavedSettings(saved: unknown): GraphSettings {
  const parsed = settingsSchema.safeParse(saved);
  return parsed.success ? parsed.data : DEFAULT_GRAPH_SETTINGS;
}
