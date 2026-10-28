import {
  groupColorLookup,
  primaryEntityName,
  primaryPageTitle,
  type GraphColor,
  type GraphGroup,
  type GraphNode,
  type GroupingId,
} from "@/lib/graph";
import { entityColor } from "@/lib/graph/domainColors";
import { hasHubBody } from "@/lib/graph/nodeTypes";

// =====================================================================
// GROUP COLORS: the dot color each grouping paints. One builder per
// grouping, so a new grouping without a color fails the type check.
// Hub dots paint their own shade, so they get no group color.
// =====================================================================

export type GroupColorOf = (node: GraphNode) => GraphColor | null;

export const GROUP_COLORS: Readonly<
  Record<GroupingId, (groups: readonly GraphGroup[]) => GroupColorOf>
> = {
  // The color groups from the panel
  domain: (groups) => groupColorLookup(groups),
  entity: () => (node) => {
    if (hasHubBody(node)) return null;
    const name = primaryEntityName(node);
    return name ? entityColor(name) : null;
  },
  // Cited units take their article's color; suggestions are blue, or orange for a merge
  page: () => (node) => {
    if (hasHubBody(node)) return null;
    const title = primaryPageTitle(node);
    if (title) return entityColor(title);
    if (!node.recommendedTitle) return "muted";
    return node.recommendedKind === "merge" ? "needs-you" : "link";
  },
};
