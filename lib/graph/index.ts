// =====================================================================
// GRAPH DOMAIN: the Obsidian-style graph view's model and rules.
// Rows -> graph (build), what shows (filters), colors (groups), the
// local graph (neighborhood), layout (physics), pan/zoom (camera) and
// the panel's settings. UI lives in components/graph.
// =====================================================================

export type * from "./types";
export { buildGraph, countDegrees, shortLabel } from "./build";
export { applyFilters, createdBy, keepNodes, type GraphFilters } from "./filters";
export { GRAPH_COLORS, groupColorLookup, parseGroupQuery, type GraphColor, type GraphGroup } from "./groups";
export { neighborhood } from "./neighborhood";
export { relatedLinks, scoreRelatedPairs, withRelated, type RelatedOptions, type ScoredPair } from "./related";
export {
  DEFAULT_GRAPH_SETTINGS,
  DISPLAY_SLIDERS,
  FORCE_SLIDERS,
  parseSavedSettings,
  type GraphDisplay,
  type GraphForces,
  type GraphSettings,
  type SliderRule,
} from "./settings";
export { useGraphData } from "./useGraphData";
