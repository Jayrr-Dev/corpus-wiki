import type { ClusterGroup } from "./clusters";
import { entityColor } from "./domainColors";
import type { GraphColor } from "./groups";
import { hasHubBody, type GraphNodeKind } from "./nodeTypes";
import type { GraphNode } from "./types";

// =====================================================================
// GROUPINGS: one entry per way of drawing circles around dots. Only
// one is on at a time. The panel's switches and help, and the layout's
// circle rules, all read from here, so a new grouping is one entry.
// =====================================================================

export const GROUPING_IDS = ["domain", "entity", "stakeholder", "page"] as const;
export type GroupingId = (typeof GROUPING_IDS)[number];

// Page and section titles can contain "/". Keep their circle keys apart with a separator they cannot include.
export const PAGE_SEP = "\u001f";

// What the placement rules read from a dot. Cluster callers may leave the id, label and kind out.
export type PlacedNode = Pick<
  GraphNode,
  | "domainPaths"
  | "entityNames"
  | "stakeholderNames"
  | "pageTitles"
  | "recommendedTitle"
  | "recommendedKind"
  | "sourceScopes"
> & {
  id?: string;
  label?: string;
  degree?: number;
  kind?: GraphNode["kind"];
  pageSections?: GraphNode["pageSections"];
  articleCreatedAt?: GraphNode["articleCreatedAt"];
};

// One end of a link: an id, or the node once d3 has swapped it in (d3 also allows numeric ids)
export type LinkEnd<N extends { id: string } = { id: string }> =
  | string
  | number
  | N;

// What a second click on an already selected page-mode circle opens.
export type CircleOpenTarget =
  | { kind: "article"; title: string }
  | { kind: "section"; page: string; section: string }
  | { kind: "recommendation"; title: string };

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
  // PLACEMENT. Segments of the dot's circle path, outermost first ([] when it sits in no circle).
  segments(
    node: PlacedNode,
    subgroups: ReadonlyMap<string, string> | null,
  ): string[];
  // True when this dot belongs in the circle with this key
  holds(node: PlacedNode, key: string): boolean;
  // Nested circles worked out from the links, by node id (page: the groups inside No article)
  subgroups?(
    nodes: readonly PlacedNode[],
    links: readonly { source: LinkEnd; target: LinkEnd }[],
  ): Map<string, string>;
  // Place of a nested circle among its siblings (page: section position)
  order?(node: PlacedNode, segments: readonly string[], depth: number): number;
  // Sibling order of circles
  compare(a: ClusterGroup, b: ClusterGroup): number;
  // Ring color, so it matches the dots inside it. Domain circles leave it to the canvas.
  color?(group: ClusterGroup): GraphColor;
  // Shown on a suggestion circle
  badge?(group: ClusterGroup): "Merge" | "New Article" | undefined;
  // When the article or section behind this circle was created
  createdAt?(
    nodes: readonly PlacedNode[],
    group: ClusterGroup,
  ): string | undefined;
  // What a second click on an already selected circle opens
  openTarget?(circle: {
    label: string;
    parent: string;
  }): CircleOpenTarget | null;
}

// The entity a dot sits inside when several are named (same rule as the first domain path)
export function primaryEntityName(
  node: Pick<GraphNode, "entityNames">,
): string | null {
  return (
    [...(node.entityNames ?? [])].sort((a, b) => a.localeCompare(b))[0] ?? null
  );
}

// The stakeholder a dot sits inside when several are named (same rule as entities)
export function primaryStakeholderName(
  node: Pick<GraphNode, "stakeholderNames">,
): string | null {
  return (
    [...(node.stakeholderNames ?? [])].sort((a, b) => a.localeCompare(b))[0] ??
    null
  );
}

// The page a dot sits inside when several cite it
export function primaryPageTitle(
  node: Pick<GraphNode, "pageTitles">,
): string | null {
  return (
    [...(node.pageTitles ?? [])].sort((a, b) => a.localeCompare(b))[0] ?? null
  );
}

// Catch-all circle for knowledge that no article cites. It only appears when something sits in it.
export const NO_ARTICLE_LABEL = "No article";
export const ORPHANS_LABEL = "Orphans";
export const EXTERNAL_LABEL = "External";
export const LINKED_LABEL = "Linked";

export function isReservedCircleLabel(label: string): boolean {
  return (
    label === ORPHANS_LABEL ||
    label === EXTERNAL_LABEL ||
    label === LINKED_LABEL
  );
}

// A domain hub: a layer of its own that joins an article only when grouping gave it one
function hubBodied(node: PlacedNode): boolean {
  return node.kind !== undefined && hasHubBody({ kind: node.kind });
}

// A hub joins an article only when grouping gave it one. Other notes with
// no article join the catch-all.
function pageCircleName(node: PlacedNode): string | null {
  const title = primaryPageTitle(node);
  if (hubBodied(node)) return title;
  return title ?? NO_ARTICLE_LABEL;
}

// Earliest section of the chosen article. A unit cited by several sections has one home.
function primarySectionTitle(node: PlacedNode, page: string): string | null {
  const matches = (node.pageSections ?? []).filter(
    (placement) => placement.page === page,
  );
  matches.sort(
    (a, b) => a.position - b.position || a.section.localeCompare(b.section),
  );
  return matches[0]?.section ?? null;
}

// The most-connected dot in No article, and the dots linked to it, share one nested group.
function hubNesting(
  nodes: readonly PlacedNode[],
  links: readonly {
    source: LinkEnd;
    target: LinkEnd;
  }[],
): Map<string, string> {
  const loose = nodes.filter((node) => {
    if (hubBodied(node) || !node.id) return false;
    if (primaryPageTitle(node)) return false;
    return !node.recommendedTitle?.split(PAGE_SEP).join(" ").trim();
  });
  const ids = new Set(loose.map((node) => node.id!));
  const degree = new Map(loose.map((node) => [node.id!, node.degree ?? 0]));
  const neighbors = new Map<string, Set<string>>();
  const linked = new Set<string>();
  const endId = (end: LinkEnd) =>
    typeof end === "object" ? end.id : String(end);
  for (const link of links) {
    const source = endId(link.source);
    const target = endId(link.target);
    linked.add(source);
    linked.add(target);
    if (!ids.has(source) || !ids.has(target) || source === target) continue;
    const from = neighbors.get(source) ?? new Set<string>();
    from.add(target);
    neighbors.set(source, from);
    const to = neighbors.get(target) ?? new Set<string>();
    to.add(source);
    neighbors.set(target, to);
  }
  const chosen = new Map<string, string>();
  for (const node of loose) {
    const id = node.id!;
    if ((neighbors.get(id)?.size ?? 0) === 0) continue;
    let best = id;
    let bestDegree = degree.get(id) ?? 0;
    for (const other of neighbors.get(id) ?? []) {
      const next = degree.get(other) ?? 0;
      if (next > bestDegree) {
        best = other;
        bestDegree = next;
      }
    }
    if (bestDegree < 2) continue;
    chosen.set(id, best);
  }
  const counts = new Map<string, number>();
  for (const hub of chosen.values())
    counts.set(hub, (counts.get(hub) ?? 0) + 1);
  for (const [id, hub] of chosen) {
    if ((counts.get(hub) ?? 0) < 2) chosen.delete(id);
  }
  for (const node of loose) {
    const id = node.id!;
    if (chosen.has(id)) continue;
    if (node.sourceScopes?.includes("external")) {
      chosen.set(id, EXTERNAL_LABEL);
      continue;
    }
    if (!linked.has(id)) chosen.set(id, ORPHANS_LABEL);
  }
  // Linked nodes that never joined a hub share one circle. A claim title is the
  // wrong name: their links usually leave the circle, so the busiest claim
  // does not describe the group.
  const rest: string[] = [];
  for (const node of loose) {
    const id = node.id!;
    if (chosen.has(id)) continue;
    rest.push(id);
  }
  if (rest.length >= 2) for (const id of rest) chosen.set(id, LINKED_LABEL);
  return chosen;
}

// A suggestion inside No article. Merges are orange; a new article is blue.
function suggestionColor(group: ClusterGroup): GraphColor {
  const merge = group.members.some((node) => node.recommendedKind === "merge");
  return merge ? "needs-you" : "link";
}

function byLabel(a: ClusterGroup, b: ClusterGroup): number {
  return a.label.localeCompare(b.label);
}

// Topic tree: the primary domain path, one segment per level
function domainSegments(node: PlacedNode): string[] {
  return ([...node.domainPaths].sort()[0] ?? "").split("/").filter(Boolean);
}

// One flat circle per name
function entitySegments(node: PlacedNode): string[] {
  const name = primaryEntityName(node);
  return name ? [name] : [];
}

function stakeholderSegments(node: PlacedNode): string[] {
  const name = primaryStakeholderName(node);
  return name ? [name] : [];
}

// Article, then section. Notes with no article sit in No article, nested by suggestion or hub.
function pageSegments(
  node: PlacedNode,
  subgroups: ReadonlyMap<string, string> | null,
): string[] {
  const title = pageCircleName(node);
  if (!title) return [];
  if (title === NO_ARTICLE_LABEL) {
    const recommended = node.recommendedTitle
      ?.split(PAGE_SEP)
      .join(" ")
      .trim();
    if (recommended) return [title, recommended];
    const hub = node.id ? subgroups?.get(node.id) : undefined;
    return hub ? [title, hub] : [title];
  }
  const section = primarySectionTitle(node, title);
  return section ? [title, section] : [title];
}

export const GROUPINGS: Readonly<Record<GroupingId, GroupingRule>> = {
  domain: {
    id: "domain",
    label: "Domain",
    hubKind: "domain",
    separator: "/",
    nests: true,
    segments: domainSegments,
    // Any of its domains counts, not only the primary one
    holds: (node, key) =>
      node.domainPaths.some(
        (path) => path === key || path.startsWith(`${key}/`),
      ),
    compare: byLabel,
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
    segments: entitySegments,
    holds: (node, key) => primaryEntityName(node) === key,
    compare: byLabel,
    color: (group) => entityColor(group.label),
    help: [
      "Entities draws a colored circle around each entity. Knowledge units sit inside it. Domain nodes show there only when Domains is on in Nodes. Each domain sits in the entity most of its knowledge is about. A domain with none of its own sits with the domain it connects to most.",
    ],
  },
  stakeholder: {
    id: "stakeholder",
    label: "Stakeholders",
    hubKind: "stakeholder",
    separator: "/",
    nests: false,
    segments: stakeholderSegments,
    holds: (node, key) => primaryStakeholderName(node) === key,
    compare: byLabel,
    color: (group) => entityColor(group.label),
    help: [
      "Stakeholders draws a colored circle around each stakeholder: an entity whose profile marks it as one. Knowledge units about it sit inside, and the stakeholder node sits in the middle when Stakeholders is on in Nodes. Other entities, domains and pages sit in the stakeholder most of their knowledge is about.",
    ],
  },
  page: {
    id: "page",
    label: "Pages",
    hubKind: "page",
    separator: PAGE_SEP,
    nests: true,
    segments: pageSegments,
    holds: (node, key) => {
      const segments = pageSegments(node, null);
      if (segments.length === 0) return false;
      const path = segments.join(PAGE_SEP);
      return path === key || path.startsWith(`${key}${PAGE_SEP}`);
    },
    subgroups: hubNesting,
    order: (node, segments, depth) =>
      depth > 0
        ? (node.pageSections?.find(
            (placement) =>
              placement.page === segments[0] &&
              placement.section === segments[depth],
          )?.position ?? 0)
        : 0,
    // Sections in article order. No article comes last.
    compare: (a, b) => {
      if (a.depth > 0 && b.depth > 0)
        return a.order - b.order || a.label.localeCompare(b.label);
      if (a.label === NO_ARTICLE_LABEL) return 1;
      if (b.label === NO_ARTICLE_LABEL) return -1;
      return a.label.localeCompare(b.label);
    },
    color: (group) =>
      group.quiet
        ? "muted"
        : group.label === NO_ARTICLE_LABEL ||
            group.label === ORPHANS_LABEL ||
            group.label === LINKED_LABEL
          ? "muted"
          : group.label === EXTERNAL_LABEL
            ? "graph-teal"
            : group.parent === NO_ARTICLE_LABEL
              ? suggestionColor(group)
              : entityColor(group.parent || group.label),
    badge: (group) =>
      group.parent === NO_ARTICLE_LABEL &&
      !group.quiet &&
      !isReservedCircleLabel(group.label)
        ? suggestionColor(group) === "needs-you"
          ? "Merge"
          : "New Article"
        : undefined,
    // The No article catch-all has no created time
    createdAt: (nodes, group) => {
      if (group.label === NO_ARTICLE_LABEL || group.parent === NO_ARTICLE_LABEL)
        return undefined;
      const times = nodes.find(
        (node) => node.articleCreatedAt,
      )?.articleCreatedAt;
      if (!times) return undefined;
      return group.parent === ""
        ? times.pages.get(group.label)
        : times.sections.get(group.path);
    },
    // Page circles open the article, section circles open that section, and a suggestion
    // circle inside No article opens the recommendation. The No article circle itself does not.
    openTarget: (circle) => {
      if (circle.parent === "") {
        if (circle.label === NO_ARTICLE_LABEL) return null;
        return { kind: "article", title: circle.label };
      }
      if (circle.parent === NO_ARTICLE_LABEL) {
        if (isReservedCircleLabel(circle.label)) return null;
        return { kind: "recommendation", title: circle.label };
      }
      return { kind: "section", page: circle.parent, section: circle.label };
    },
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
