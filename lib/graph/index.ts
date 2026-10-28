// =====================================================================
// GRAPH DOMAIN: the Obsidian-style graph view's model and rules.
// Rows -> graph (build), what shows (filters), colors (groups), the
// local graph (neighborhood), layout (physics), pan/zoom (camera) and
// the panel's settings. UI lives in components/graph.
// =====================================================================

export { buildGraph, countDegrees, shortLabel } from "./build";
export {
  facingEdges,
  routeControls,
  routeDomains,
  straightenRoute,
  summaryDomains,
  type RouteCircle,
  type RoutePoint,
} from "./bundles";
export {
  circleAt,
  circleExtents,
  clusterCircles,
  clusterTree,
  deepestPaths,
  moveTarget,
  nodeInCluster,
  primaryEntityName,
  primaryPageTitle,
  type ClusterCircle,
  type ClusterGroup,
  type ClusterMode,
} from "./clusters";
export {
  applyFilters,
  createdBy,
  domainPathsForScope,
  graphForGrouping,
  keepNodes,
  type GraphFilters,
} from "./filters";
export {
  GRAPH_COLORS,
  GROUP_FIELDS,
  groupColorLookup,
  groupCounts,
  groupSuggestions,
  joinGroupQuery,
  parseGroupQuery,
  splitGroupQuery,
  type GraphColor,
  type GraphGroup,
  type GroupField,
} from "./groups";
export { neighborhood } from "./neighborhood";
export {
  relatedLinks,
  scoreRelatedPairs,
  withRelated,
  type RelatedOptions,
  type ScoredPair,
} from "./related";
export {
  DEFAULT_GRAPH_SETTINGS,
  DISPLAY_SLIDERS,
  FORCE_SLIDERS,
  GRAPH_GROUP_BY,
  parseSavedSettings,
  TITLE_POSITIONS,
  type GraphDisplay,
  type GraphForces,
  type GraphGroupBy,
  type GraphSettings,
  type SliderRule,
  type TitlePosition,
} from "./settings";
export type * from "./types";
export { useGraphData } from "./useGraphData";
