import type { Enums } from "@/lib/database/types";

// =====================================================================
// GRAPH MODEL: what the graph view draws, independent of how it is
// stored. Units are the notes; entities and pages are optional layers
// (like Obsidian's tags); links are typed.
// =====================================================================

// NODE KINDS
export type GraphNodeKind = "unit" | "entity" | "page" | "domain";

// LINK KINDS: the seven relationship types, plus "about" (unit or page -> entity), "cites" (page -> unit),
// "in" (unit or page -> domain), and "similar" (derived relatedness between units, never stored; see related.ts)
export type RelationshipType = Enums<"relationship_type">;
export type GraphLinkKind =
  | RelationshipType
  | "about"
  | "cites"
  | "in"
  | "similar";

// NODE: one dot. `degree` counts every link in the full graph and sizes the dot.
export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  // Full text relatedness is scored on (a unit's claim; the label for other kinds)
  text: string;
  href: string;
  createdAt: string;
  // Latest change, use in an article, move, or applied action. Units only.
  activityAt?: string;
  // Created times for articles and their sections, shared by every node.
  articleCreatedAt?: {
    pages: ReadonlyMap<string, string>;
    sections: ReadonlyMap<string, string>;
  };
  degree: number;
  // Set when this dot stands in for several claims. The ids are the real claims.
  memberIds?: readonly string[];
  // What group queries match on
  domainPaths: string[];
  domainScopePaths?: { internal: string[]; external: string[] };
  sourceScopes?: ("internal" | "external")[];
  entityNames: string[];
  // Pages that cite this unit (own title on page nodes; omitted on older fixtures)
  pageTitles?: string[];
  // Title of a pending article suggestion that includes this unit
  recommendedTitle?: string;
  // create is a new article; merge adds these units to an existing one
  recommendedKind?: "create" | "merge";
  // Sections that cite this unit, in the article they belong to
  pageSections?: { page: string; section: string; position: number }[];
  unitKind: Enums<"unit_kind"> | null;
  status: Enums<"epistemic_status"> | null;
}

// LINK: one line from `source` to `target` (direction matters for arrows)
export interface GraphLink {
  id: string;
  source: string;
  target: string;
  kind: GraphLinkKind;
}

// GRAPH: the nodes and links shown together
export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}
