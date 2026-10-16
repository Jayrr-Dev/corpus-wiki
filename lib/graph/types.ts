import type { Enums } from "@/lib/database/types";

// =====================================================================
// GRAPH MODEL: what the graph view draws, independent of how it is
// stored. Units are the notes; entities and pages are optional layers
// (like Obsidian's tags); links are typed.
// =====================================================================

// NODE KINDS
export type GraphNodeKind = "unit" | "entity" | "page";

// LINK KINDS: the seven relationship types, plus "about" (unit or page -> entity), "cites" (page -> unit)
// and "similar" (derived relatedness between units, never stored; see related.ts)
export type RelationshipType = Enums<"relationship_type">;
export type GraphLinkKind = RelationshipType | "about" | "cites" | "similar";

// NODE: one dot. `degree` counts every link in the full graph and sizes the dot.
export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  // Full text relatedness is scored on (a unit's claim; the label for other kinds)
  text: string;
  href: string;
  createdAt: string;
  degree: number;
  // What group queries match on
  domainPaths: string[];
  domainScopePaths?: { internal: string[]; external: string[] };
  entityNames: string[];
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
