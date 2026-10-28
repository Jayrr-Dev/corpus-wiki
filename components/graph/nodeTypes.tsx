import type { GraphNode } from "@/lib/graph";
import type { GraphNodeKind } from "@/lib/graph/nodeTypes";
import type { ReactNode } from "react";
import {
  DomainPreview,
  EntityPreview,
  PagePreview,
  UnitPreview,
} from "./NodePreviews";

// =====================================================================
// NODE SCREENS: what each kind of dot shows on screen, beside the
// traits in lib/graph/nodeTypes.ts. Keyed by kind, so a new kind fails
// the type check until it has a preview here.
// =====================================================================

export interface NodeScreenRule {
  // The preview dialog's body for a clicked dot. units: the graph's knowledge units, for the list on the right.
  preview: (node: GraphNode, units: readonly GraphNode[]) => ReactNode;
  // Wide dialog with the related knowledge units listed on the right. Off: a single column.
  listsUnits: boolean;
}

export const NODE_SCREENS: Readonly<Record<GraphNodeKind, NodeScreenRule>> = {
  unit: {
    preview: (node) => <UnitPreview key={node.id} node={node} />,
    listsUnits: false,
  },
  entity: {
    preview: (node, units) => (
      <EntityPreview key={node.id} node={node} units={units} />
    ),
    listsUnits: true,
  },
  domain: {
    preview: (node, units) => (
      <DomainPreview key={node.id} node={node} units={units} />
    ),
    listsUnits: true,
  },
  page: {
    preview: (node, units) => (
      <PagePreview key={node.id} node={node} units={units} />
    ),
    listsUnits: true,
  },
};
