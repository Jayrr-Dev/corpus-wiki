import type { GraphNodeKind } from "./nodeTypes";

// =====================================================================
// GROUPINGS: one entry per way of drawing circles around dots. Only
// one is on at a time. The panel's switches and help, and the layout's
// circle rules, all read from here, so a new grouping is one entry.
// =====================================================================

export const GROUPING_IDS = ["domain", "entity", "page"] as const;
export type GroupingId = (typeof GROUPING_IDS)[number];

// Page and section titles can contain "/". Keep their circle keys apart with a separator they cannot include.
export const PAGE_SEP = "\u001f";

export interface GroupingRule {
  id: GroupingId;
  // Switch label in the Group section
  label: string;
  // Help bullets for the Group section's info popover
  help: readonly string[];
  // The node kind each circle is built around
  hubKind: GraphNodeKind;
  // Joins the segments of a nested circle key
  separator: string;
  // Circles sit inside other circles (topic tree, article then section)
  nests: boolean;
}

export const GROUPINGS: Readonly<Record<GroupingId, GroupingRule>> = {
  domain: {
    id: "domain",
    label: "Domain",
    hubKind: "domain",
    separator: "/",
    nests: true,
    help: [
      "Domain draws a circle around each topic. That circle is separate from the domain node. With Domains on in Nodes, the node sits in the middle of its circle and grows with its connections.",
    ],
  },
  entity: {
    id: "entity",
    label: "Entities",
    hubKind: "entity",
    separator: "/",
    nests: false,
    help: [
      "Entities draws a colored circle around each entity. Knowledge units sit inside it. Domain nodes show there only when Domains is on in Nodes. Each domain sits in the entity most of its knowledge is about. A domain with none of its own sits with the domain it connects to most.",
    ],
  },
  page: {
    id: "page",
    label: "Pages",
    hubKind: "page",
    separator: PAGE_SEP,
    nests: true,
    help: [
      "Pages draws a circle around each article. Each section is a circle inside it, and the knowledge that section uses sits there. Domain nodes show there only when Domains is on in Nodes. Each domain sits in the article, and the section, that uses most of its knowledge. A domain with none of its own sits with the domain it connects to most.",
      "A unit used in more than one section sits in the earliest one.",
      "Click a selected article, section, or suggestion again to open it.",
      "Drag one knowledge unit onto an article, a section, or a suggestion. An article drop uses the earliest section that can take one claim. A blue suggestion adds it to that new article. An orange Merge suggestion adds it to that merge. Go back to the overview before dropping it on a different group.",
      "Units that no article cites gather in a gray No article circle. Inside it, a node with the most connections and the nodes linked to it form a nested group, with a black border and that node name. Linked nodes that never join a hub sit together in Linked. A node with no links at all sits in Orphans. A link to anything else leaves it in No article. Nodes from an external source sit in External. A pending suggestion groups its units inside that circle. A new article is blue. A merge is orange and marked Merge. The newest 10% of knowledge units changed, used, moved, or applied keep a green border. The newest 10% of articles and the newest 10% of sections have a yellow ring. Inside a selected group, that share is of the group.",
    ],
  },
};

// Panel order
export const GROUPING_LIST: readonly GroupingRule[] = GROUPING_IDS.map(
  (id) => GROUPINGS[id],
);

// A saved or typed value, checked against the registry
export function isGroupingId(value: unknown): value is GroupingId {
  return (GROUPING_IDS as readonly unknown[]).includes(value);
}
