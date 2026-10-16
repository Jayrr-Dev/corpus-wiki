import { z } from "zod";
import type { GraphFilters } from "./filters";
import { GRAPH_COLORS, splitGroupQuery, type GraphGroup } from "./groups";
import { chooseDomainColor, themeAutomaticGroups } from "./domainColors";
import type { GraphNode } from "./types";

// =====================================================================
// GRAPH SETTINGS: everything the panel controls, with Obsidian-like
// defaults. The slider ranges are data, so the panel renders one row
// per entry instead of hand-writing each slider.
// =====================================================================

// Where a note's title sits relative to its dot
export const TITLE_POSITIONS = ["top", "bottom", "left", "right"] as const;
export type TitlePosition = (typeof TITLE_POSITIONS)[number];

export interface GraphDisplay {
  arrows: boolean;
  // Circles around each domain and subdomain
  domainCircles: boolean;
  titlePosition: TitlePosition;
  textFadeThreshold: number;
  nodeSize: number;
  linkThickness: number;
}

export interface GraphForces {
  center: number;
  repel: number;
  link: number;
  linkDistance: number;
  // How strongly dots gather by domain
  cluster: number;
}

export interface GraphSettings {
  filters: GraphFilters;
  groups: GraphGroup[];
  // Remember discovered domains so removed or edited defaults stay changed.
  colorGroupDomains?: string[];
  colorThemeVersion?: number;
  display: GraphDisplay;
  forces: GraphForces;
}

// DEFAULTS: domain color groups are populated when graph data arrives.
export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  filters: { domainScope: "internal", search: "", domain: "", showUnits: true, showEntities: false, showPages: false, showOrphans: true, showRelated: true, relatedness: 0.3 },
  groups: [],
  colorGroupDomains: [],
  colorThemeVersion: 1,
  display: { arrows: false, domainCircles: true, titlePosition: "bottom", textFadeThreshold: 0, nodeSize: 1, linkThickness: 1 },
  forces: { center: 0.4, repel: 11, link: 0.8, linkDistance: 80, cluster: 0.5 },
};

// SLIDER RULES: label, range and step for each numeric setting
export interface SliderRule<K extends string> {
  key: K;
  label: string;
  min: number;
  max: number;
  step: number;
}

export const DISPLAY_SLIDERS: readonly SliderRule<Exclude<keyof GraphDisplay, "arrows" | "domainCircles" | "titlePosition">>[] = [
  { key: "textFadeThreshold", label: "Text fade threshold", min: -3, max: 3, step: 0.1 },
  { key: "nodeSize", label: "Node size", min: 0.1, max: 5, step: 0.1 },
  { key: "linkThickness", label: "Link thickness", min: 0.1, max: 5, step: 0.1 },
];

export const FORCE_SLIDERS: readonly SliderRule<keyof GraphForces>[] = [
  { key: "center", label: "Center force", min: 0, max: 1, step: 0.01 },
  { key: "repel", label: "Repel force", min: 0, max: 20, step: 0.1 },
  { key: "link", label: "Link force", min: 0, max: 1, step: 0.01 },
  { key: "linkDistance", label: "Link distance", min: 10, max: 300, step: 1 },
  { key: "cluster", label: "Domain pull", min: 0, max: 1, step: 0.01 },
];

const DEFAULT_RELATED = { showRelated: DEFAULT_GRAPH_SETTINGS.filters.showRelated, relatedness: DEFAULT_GRAPH_SETTINGS.filters.relatedness };
const { display: DEFAULT_DISPLAY, forces: DEFAULT_FORCES } = DEFAULT_GRAPH_SETTINGS;

// SAVED SETTINGS SCHEMA: anything stored that no longer fits falls back to the default
const colorTokens = GRAPH_COLORS.map((color) => color.token) as [GraphGroup["color"], ...GraphGroup["color"][]];
const settingsSchema = z.object({
  // Fields added later default, so older saved settings keep everything else
  filters: z.object({
    domainScope: z.enum(["internal", "external", "both", "none"]).default("internal"),
    search: z.string(),
    domain: z.string().default(""),
    showUnits: z.boolean().default(true),
    showEntities: z.boolean(),
    showPages: z.boolean(),
    showOrphans: z.boolean(),
    showRelated: z.boolean().default(DEFAULT_RELATED.showRelated),
    relatedness: z.number().default(DEFAULT_RELATED.relatedness),
  }),
  groups: z.array(z.object({ id: z.string(), query: z.string(), color: z.enum(colorTokens) })),
  colorGroupDomains: z.array(z.string()).default([]),
  colorThemeVersion: z.number().default(0),
  display: z.object({ arrows: z.boolean(), domainCircles: z.boolean().default(DEFAULT_DISPLAY.domainCircles), titlePosition: z.enum(TITLE_POSITIONS).default(DEFAULT_DISPLAY.titlePosition), textFadeThreshold: z.number(), nodeSize: z.number(), linkThickness: z.number() }),
  forces: z.object({ center: z.number(), repel: z.number(), link: z.number(), linkDistance: z.number(), cluster: z.number().default(DEFAULT_FORCES.cluster) }),
});

// Reads saved settings; the defaults when nothing valid was saved
export function parseSavedSettings(saved: unknown): GraphSettings {
  const parsed = settingsSchema.safeParse(saved);
  if (!parsed.success) return DEFAULT_GRAPH_SETTINGS;
  const settings = parsed.data;
  if (settings.colorThemeVersion < 1) {
    settings.groups = themeAutomaticGroups(settings.groups);
    settings.colorThemeVersion = 1;
  }
  // Upgrade the previous untouched defaults while retaining deliberate adjustments.
  const previousDefaults = [
    { center: 0.5, repel: 10, link: 1, linkDistance: 60, cluster: 0.5 },
    { center: 0.2, repel: 14, link: 0.6, linkDistance: 110, cluster: 0.7 },
  ];
  if (previousDefaults.some((previous) => (Object.keys(previous) as (keyof GraphForces)[]).every((key) => settings.forces[key] === previous[key]))) {
    settings.forces = { ...DEFAULT_FORCES };
  }
  return settings;
}

// Seed three domain levels once. Children precede their ancestors
// in matching order, so the parent's broad match cannot hide a child's color.
// changes and removals survive reloads, and newly discovered domains still get colors.
export function withDomainColorGroups(settings: GraphSettings, nodes: readonly GraphNode[]): GraphSettings {
  const roots = new Map<string, string>();
  for (const node of nodes) {
    for (const path of node.domainPaths) {
      const parts = path.split("/").map((part) => part.trim()).filter(Boolean);
      for (let depth = 1; depth <= Math.min(3, parts.length); depth++) {
        const domain = parts.slice(0, depth).join("/");
        roots.set(domain.toLowerCase(), domain);
      }
    }
  }
  const seen = new Set(settings.colorGroupDomains ?? []);
  const additions = [...roots.keys()].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b)).filter((root) => !seen.has(root));
  if (!additions.length) return settings;
  const groups = [...settings.groups];
  for (const root of additions) {
    seen.add(root);
    // Migrate saved custom domain groups without adding a competing default.
    if (groups.some((group) => group.query.trim().toLowerCase().replace(/\/+$/, "") === `domain:${root}` || group.query.trim().toLowerCase().replace(/\/+$/, "") === `path:${root}`)) continue;
    const ancestors = groups.filter((group) => {
      const match = splitGroupQuery(group.query);
      const path = match.value.trim().replace(/\/+$/, "").toLowerCase();
      return match.field === "domain" && path !== "" && root.startsWith(path + "/");
    });
    const parentIndex = ancestors.length ? groups.indexOf(ancestors[0]!) : -1;
    const color = chooseDomainColor(root, groups);
    const group = { id: `domain:${root}`, query: `domain:${roots.get(root)!}`, color };
    if (parentIndex >= 0) groups.splice(parentIndex, 0, group);
    else groups.push(group);
  }
  return { ...settings, groups, colorGroupDomains: [...seen] };
}
