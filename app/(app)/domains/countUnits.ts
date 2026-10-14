import type { DomainNode } from "@/lib/domains/tree";

// =====================================================================
// DOMAIN COUNTS: current units in each domain and everything below it.
// A unit in two child domains counts once for their parent.
// =====================================================================

// Unit ids per domain id (direct members only)
export function unitsByDomain(rows: readonly { unit_id: string; domain_id: string }[], isCurrent: (unitId: string) => boolean): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  rows.filter((row) => isCurrent(row.unit_id)).forEach((row) => {
    const set = map.get(row.domain_id) ?? new Set<string>();
    set.add(row.unit_id);
    map.set(row.domain_id, set);
  });
  return map;
}

// Subtree counts for every node of the forest, keyed by domain id
export function subtreeCounts(nodes: readonly DomainNode[], direct: Map<string, Set<string>>): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (node: DomainNode): Set<string> => {
    const all = new Set(direct.get(node.id));
    node.children.forEach((child) => visit(child).forEach((id) => all.add(id)));
    counts.set(node.id, all.size);
    return all;
  };
  nodes.forEach(visit);
  return counts;
}
