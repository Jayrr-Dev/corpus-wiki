import { z } from "zod";
import { chooseDomainColor, themeAutomaticGroups } from "./domainColors";
import type { GraphFilters } from "./filters";
import { GROUPING_IDS } from "./groupings";
import { GRAPH_COLORS, splitGroupQuery, type GraphGroup } from "./groups";
import { NODE_KINDS, NODE_TYPES, type GraphNodeKind } from "./nodeTypes";
import type { GraphNode } from "./types";

// =====================================================================
// GRAPH SETTINGS: everything the panel controls, with Obsidian-like
// defaults. The slider ranges are data, so the panel renders one row
// per entry instead of hand-writing each slider.
// =====================================================================

// Where a note's title sits relative to its dot
export const TITLE_POSITIONS = ["top", "bottom", "left", "right"] as const;
export type TitlePosition = (typeof TITLE_POSITIONS)[number];

// Which circles gather the dots. Only one is on at a time. "off" draws no circles.
export const GRAPH_GROUP_BY = [...GROUPING_IDS, "off"] as const;
export type GraphGroupBy = (typeof GRAPH_GROUP_BY)[number];

export interface GraphDisplay {
  arrows: boolean;
  // Green and yellow rings on the newest 10% of knowledge, articles, and sections.
  showNew: boolean;
  groupBy: GraphGroupBy;
  titlePosition: TitlePosition;
  textFadeThreshold: number;
  nodeSize: number;
  linkThickness: number;
  // Resting opacity of graph lines (0 hidden, 1 solid). Focus still brightens a line.
  edgeOpacity: number;
  // Claims that share a group draw as one dot.
  coalesce: boolean;
  // Step lists and article sections wind out in order. Off keeps the packed circles.
  ordered: boolean;
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

// Each node type's switch as its registry entry sets it
function defaultShown(): Record<GraphNodeKind, boolean> {
  return Object.fromEntries(
    NODE_KINDS.map((kind) => [kind, NODE_TYPES[kind].shownByDefault]),
  ) as Record<GraphNodeKind, boolean>;
}

// DEFAULTS: domain color groups are populated when graph data arrives.
export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  filters: {
    domainScope: "internal",
    search: "",
    domain: "",
    shown: defaultShown(),
    showOrphans: true,
    showConnectors: true,
    showRelated: true,
    relatedness: 0.3,
  },
  groups: [],
  colorGroupDomains: [],
  colorThemeVersion: 1,
  display: {
    arrows: false,
    showNew: true,
    groupBy: "domain",
    titlePosition: "top",
    textFadeThreshold: 0,
    nodeSize: 1,
    linkThickness: 1,
    edgeOpacity: 0.7,
    coalesce: false,
    ordered: false,
  },
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

export const DISPLAY_SLIDERS: readonly SliderRule<
  Exclude<
    keyof GraphDisplay,
    | "arrows"
    | "showNew"
    | "groupBy"
    | "titlePosition"
    | "edgeOpacity"
    | "coalesce"
    | "ordered"
  >
>[] = [
  {
    key: "textFadeThreshold",
    label: "Text fade threshold",
    min: -3,
    max: 3,
    step: 0.1,
  },
  { key: "nodeSize", label: "Node size", min: 0.1, max: 5, step: 0.1 },
  {
    key: "linkThickness",
    label: "Link thickness",
    min: 0.1,
    max: 5,
    step: 0.1,
  },
];

export const FORCE_SLIDERS: readonly SliderRule<keyof GraphForces>[] = [
  { key: "center", label: "Center force", min: 0, max: 1, step: 0.01 },
  { key: "repel", label: "Repel force", min: 0, max: 20, step: 0.1 },
  { key: "link", label: "Link force", min: 0, max: 1, step: 0.01 },
  { key: "linkDistance", label: "Link distance", min: 10, max: 300, step: 1 },
  { key: "cluster", label: "Domain pull", min: 0, max: 1, step: 0.01 },
];

const DEFAULT_RELATED = {
  showRelated: DEFAULT_GRAPH_SETTINGS.filters.showRelated,
  relatedness: DEFAULT_GRAPH_SETTINGS.filters.relatedness,
};
const { display: DEFAULT_DISPLAY, forces: DEFAULT_FORCES } =
  DEFAULT_GRAPH_SETTINGS;

// SAVED SETTINGS SCHEMA: anything stored that no longer fits falls back to the default
const colorTokens = GRAPH_COLORS.map((color) => color.token) as [
  GraphGroup["color"],
  ...GraphGroup["color"][],
];
const settingsSchema = z.object({
  // Fields added later default, so older saved settings keep everything else
  filters: z.object({
    domainScope: z
      .enum(["internal", "external", "both", "none"])
      .default("internal"),
    search: z.string(),
    domain: z.string().default(""),
    shown: z.record(z.string(), z.boolean()).optional(),
    // Saved before the shown map. Read once to carry each switch over.
    showUnits: z.boolean().optional(),
    showEntities: z.boolean().optional(),
    showDomains: z.boolean().optional(),
    showPages: z.boolean().optional(),
    showOrphans: z.boolean(),
    showConnectors: z.boolean().default(true),
    showRelated: z.boolean().default(DEFAULT_RELATED.showRelated),
    relatedness: z.number().default(DEFAULT_RELATED.relatedness),
  }),
  groups: z.array(
    z.object({ id: z.string(), query: z.string(), color: z.enum(colorTokens) }),
  ),
  colorGroupDomains: z.array(z.string()).default([]),
  colorThemeVersion: z.number().default(0),
  display: z.object({
    arrows: z.boolean(),
    showNew: z.boolean().default(true),
    domainCircles: z.boolean().optional(),
    // A grouping that no longer exists falls back like a missing one
    groupBy: z.enum(GRAPH_GROUP_BY).optional().catch(undefined),
    titlePosition: z
      .enum(TITLE_POSITIONS)
      .default(DEFAULT_DISPLAY.titlePosition),
    textFadeThreshold: z.number(),
    nodeSize: z.number(),
    linkThickness: z.number(),
    edgeOpacity: z.number().default(DEFAULT_DISPLAY.edgeOpacity),
    coalesce: z.boolean().default(false),
    ordered: z.boolean().default(false),
  }),
  forces: z.object({
    center: z.number(),
    repel: z.number(),
    link: z.number(),
    linkDistance: z.number(),
    cluster: z.number().default(DEFAULT_FORCES.cluster),
  }),
});

// The switch each node type had before the shown map
const LEGACY_SHOWN: Partial<
  Record<
    GraphNodeKind,
    "showUnits" | "showEntities" | "showDomains" | "showPages"
  >
> = {
  unit: "showUnits",
  entity: "showEntities",
  domain: "showDomains",
  page: "showPages",
};

type SavedFilters = z.infer<typeof settingsSchema>["filters"];

// Saved switches win, then the old per-type fields, then the kind it split from, then the registry default
function shownFrom(saved: SavedFilters): Record<GraphNodeKind, boolean> {
  const shown = defaultShown();
  for (const kind of NODE_KINDS) {
    const field = LEGACY_SHOWN[kind];
    const legacy = field ? saved[field] : undefined;
    // A split-off kind's parent comes earlier in NODE_KINDS, so its switch is already read
    const parent = NODE_TYPES[kind].splitFrom;
    shown[kind] =
      saved.shown?.[kind] ?? legacy ?? (parent ? shown[parent] : shown[kind]);
  }
  return shown;
}

// Reads saved settings; the defaults when nothing valid was saved
export function parseSavedSettings(saved: unknown): GraphSettings {
  const parsed = settingsSchema.safeParse(saved);
  if (!parsed.success) return DEFAULT_GRAPH_SETTINGS;
  const { filters: savedFilters, ...settings } = parsed.data;
  const filters: GraphFilters = {
    domainScope: savedFilters.domainScope,
    search: savedFilters.search,
    domain: savedFilters.domain,
    shown: shownFrom(savedFilters),
    showOrphans: savedFilters.showOrphans,
    showConnectors: savedFilters.showConnectors,
    showRelated: savedFilters.showRelated,
    relatedness: savedFilters.relatedness,
  };
  const {
    domainCircles,
    groupBy: savedGroup,
    ...displayRest
  } = settings.display;
  const display: GraphDisplay = {
    ...displayRest,
    groupBy: savedGroup ?? (domainCircles === false ? "off" : "domain"),
  };
  if (settings.colorThemeVersion < 1) {
    settings.groups = themeAutomaticGroups(settings.groups);
    settings.colorThemeVersion = 1;
  }
  // Upgrade the previous untouched defaults while retaining deliberate adjustments.
  const previousDefaults = [
    { center: 0.5, repel: 10, link: 1, linkDistance: 60, cluster: 0.5 },
    { center: 0.2, repel: 14, link: 0.6, linkDistance: 110, cluster: 0.7 },
  ];
  if (
    previousDefaults.some((previous) =>
      (Object.keys(previous) as (keyof GraphForces)[]).every(
        (key) => settings.forces[key] === previous[key],
      ),
    )
  ) {
    settings.forces = { ...DEFAULT_FORCES };
  }
  return { ...settings, filters, display };
}

// Seed three domain levels once. Children precede their ancestors
// in matching order, so the parent's broad match cannot hide a child's color.
// changes and removals survive reloads, and newly discovered domains still get colors.
export function withDomainColorGroups(
  settings: GraphSettings,
  nodes: readonly GraphNode[],
): GraphSettings {
  const roots = new Map<string, string>();
  for (const node of nodes) {
    for (const path of node.domainPaths) {
      const parts = path
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean);
      for (let depth = 1; depth <= Math.min(3, parts.length); depth++) {
        const domain = parts.slice(0, depth).join("/");
        roots.set(domain.toLowerCase(), domain);
      }
    }
  }
  const seen = new Set(settings.colorGroupDomains ?? []);
  const additions = [...roots.keys()]
    .sort(
      (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
    )
    .filter((root) => !seen.has(root));
  if (!additions.length) return settings;
  const groups = [...settings.groups];
  for (const root of additions) {
    seen.add(root);
    // Migrate saved custom domain groups without adding a competing default.
    if (
      groups.some(
        (group) =>
          group.query.trim().toLowerCase().replace(/\/+$/, "") ===
            `domain:${root}` ||
          group.query.trim().toLowerCase().replace(/\/+$/, "") ===
            `path:${root}`,
      )
    )
      continue;
    const ancestors = groups.filter((group) => {
      const match = splitGroupQuery(group.query);
      const path = match.value.trim().replace(/\/+$/, "").toLowerCase();
      return (
        match.field === "domain" && path !== "" && root.startsWith(path + "/")
      );
    });
    const parentIndex = ancestors.length ? groups.indexOf(ancestors[0]!) : -1;
    const color = chooseDomainColor(root, groups);
    const group = {
      id: `domain:${root}`,
      query: `domain:${roots.get(root)!}`,
      color,
    };
    if (parentIndex >= 0) groups.splice(parentIndex, 0, group);
    else groups.push(group);
  }
  return { ...settings, groups, colorGroupDomains: [...seen] };
}
