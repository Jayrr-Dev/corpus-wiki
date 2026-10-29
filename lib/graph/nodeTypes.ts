import type { GroupingId } from "./groupings";
import type { GraphNode } from "./types";

// =====================================================================
// NODE TYPES: one entry per kind of dot. Code asks what a node can do
// (its traits here), never which kind it is by name, so a new kind is
// one entry in NODE_TYPES plus a builder in build.ts.
// =====================================================================

export const NODE_KINDS = [
  "unit",
  "entity",
  "stakeholder",
  "page",
  "domain",
] as const;
export type GraphNodeKind = (typeof NODE_KINDS)[number];

// content: the knowledge itself (selectable as claims, coalesced, scored for relatedness).
// hub: a node a group circle can be built around.
export type NodeRole = "content" | "hub";

// Default dot gray, as a canvas palette entry. Group colors paint over it.
export type NodeShade = "text" | "muted" | "faint";

export interface NodeTypeRule {
  kind: GraphNodeKind;
  // Singular and plural names for the panel and previews
  label: string;
  plural: string;
  role: NodeRole;
  shownByDefault: boolean;
  shade: NodeShade;
  // hub: big dot that grows with links and feels neutral forces. degree: sized and pushed by its links.
  body: "hub" | "degree";
  // The grouping whose circle this node sits pinned in the middle of
  centers?: GroupingId;
  // Has no domain, scope or page of its own: domain and scope filters keep it only when it
  // links to a kept note, and it is not evidence when placing domain hubs.
  placedByLinks: boolean;
  // Split off this kind: settings saved before the split start with that kind's switch
  splitFrom?: GraphNodeKind;
}

export const NODE_TYPES: Readonly<Record<GraphNodeKind, NodeTypeRule>> = {
  unit: {
    kind: "unit",
    label: "Knowledge unit",
    plural: "Knowledge units",
    role: "content",
    shownByDefault: true,
    shade: "muted",
    body: "degree",
    placedByLinks: false,
  },
  domain: {
    kind: "domain",
    label: "Domain",
    plural: "Domains",
    role: "hub",
    shownByDefault: false,
    shade: "muted",
    body: "hub",
    centers: "domain",
    placedByLinks: true,
  },
  entity: {
    kind: "entity",
    label: "Entity",
    plural: "Entities",
    role: "hub",
    shownByDefault: false,
    shade: "faint",
    body: "degree",
    centers: "entity",
    placedByLinks: true,
  },
  stakeholder: {
    kind: "stakeholder",
    label: "Stakeholder",
    plural: "Stakeholders",
    role: "hub",
    shownByDefault: false,
    shade: "faint",
    body: "degree",
    centers: "stakeholder",
    placedByLinks: true,
    splitFrom: "entity",
  },
  page: {
    kind: "page",
    label: "Page",
    plural: "Wiki",
    role: "hub",
    shownByDefault: false,
    shade: "text",
    body: "degree",
    centers: "page",
    placedByLinks: false,
  },
};

// Panel order: content first, then hubs
export const NODE_TYPE_LIST: readonly NodeTypeRule[] = [
  NODE_TYPES.unit,
  NODE_TYPES.domain,
  NODE_TYPES.entity,
  NODE_TYPES.stakeholder,
  NODE_TYPES.page,
];

type Kinded = Pick<GraphNode, "kind">;

export function nodeType(node: Kinded): NodeTypeRule {
  return NODE_TYPES[node.kind];
}

export function isContent(node: Kinded): boolean {
  return NODE_TYPES[node.kind].role === "content";
}

export function isHub(node: Kinded): boolean {
  return NODE_TYPES[node.kind].role === "hub";
}

// Sized and pushed as a hub (today: domains)
export function hasHubBody(node: Kinded): boolean {
  return NODE_TYPES[node.kind].body === "hub";
}

// Placed by what it links to, not by its own domain or page
export function isPlacedByLinks(node: Kinded): boolean {
  return NODE_TYPES[node.kind].placedByLinks;
}

// Sits pinned in the middle of its circle when this grouping is on
export function centersGrouping(node: Kinded, grouping: GroupingId): boolean {
  return NODE_TYPES[node.kind].centers === grouping;
}

// Sits pinned in the middle of a circle in some grouping
export function centersAnyGrouping(node: Kinded): boolean {
  return NODE_TYPES[node.kind].centers !== undefined;
}
