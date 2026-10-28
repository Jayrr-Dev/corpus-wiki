import type { GroupingId } from "./groupings";
import type { GraphNode } from "./types";

// =====================================================================
// NODE TYPES: one entry per kind of dot. Code asks what a node can do
// (its traits here), never which kind it is by name, so a new kind is
// one entry in NODE_TYPES plus a builder in build.ts.
// =====================================================================

export const NODE_KINDS = ["unit", "entity", "page", "domain"] as const;
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
  },
  entity: {
    kind: "entity",
    label: "Entity",
    plural: "Entities",
    role: "hub",
    shownByDefault: false,
    shade: "faint",
    body: "degree",
  },
  page: {
    kind: "page",
    label: "Page",
    plural: "Pages",
    role: "hub",
    shownByDefault: false,
    shade: "text",
    body: "degree",
  },
};

// Panel order: content first, then hubs
export const NODE_TYPE_LIST: readonly NodeTypeRule[] = [
  NODE_TYPES.unit,
  NODE_TYPES.domain,
  NODE_TYPES.entity,
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

// Sits pinned in the middle of its circle when this grouping is on
export function centersGrouping(node: Kinded, grouping: GroupingId): boolean {
  return NODE_TYPES[node.kind].centers === grouping;
}

// Sits pinned in the middle of a circle in some grouping
export function centersAnyGrouping(node: Kinded): boolean {
  return NODE_TYPES[node.kind].centers !== undefined;
}
