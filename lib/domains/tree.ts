import type { Tables } from "@/lib/database/types";

type DomainRow = Tables<"domains">;

// One node of the domain tree, children sorted by name
export type DomainNode = DomainRow & { children: DomainNode[] };

// Builds the domain forest from flat rows (parent_id links). Rows whose parent
// is missing become roots, so a partial read never hides a branch.
export function buildDomainTree(rows: readonly DomainRow[]): DomainNode[] {
  const nodes = new Map(rows.map((row) => [row.id, { ...row, children: [] as DomainNode[] }]));
  const roots: DomainNode[] = [];
  nodes.forEach((node) => {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    (parent ? parent.children : roots).push(node);
  });
  return sortTree(roots);
}

// Sorts each level by name, recursively
function sortTree(nodes: DomainNode[]): DomainNode[] {
  return nodes
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((node) => ({ ...node, children: sortTree(node.children) }));
}
