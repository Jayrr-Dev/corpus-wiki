import type { Tables } from "@/lib/database/types";
import { buildDomainTree, type DomainNode } from "@/lib/domains/tree";
import type { DocSetSummary } from "./types";

// =====================================================================
// DOCS TREE: the Docs list (/docs) laid out on the domain tree, like the
// Study list. Topic sets hang on their domain; only branches that hold a
// set are kept. Sets from other sources, or on a retired topic, come back
// apart as `other`.
// =====================================================================

// One topic with the sets on it and every kept topic under it; `count` is the sets in the whole branch
export type DocsTreeNode = { id: string; name: string; sets: DocSetSummary[]; children: DocsTreeNode[]; count: number };

function prune(node: DomainNode, byDomain: ReadonlyMap<string, DocSetSummary[]>): DocsTreeNode | null {
  const children = node.children.map((child) => prune(child, byDomain)).filter((child): child is DocsTreeNode => child !== null);
  const sets = byDomain.get(node.id) ?? [];
  if (!sets.length && !children.length) return null;
  return { id: node.id, name: node.name, sets, children, count: children.reduce((sum, child) => sum + child.count, sets.length) };
}

export function docsTree(domains: readonly Tables<"domains">[], sets: readonly DocSetSummary[]): { roots: DocsTreeNode[]; other: DocSetSummary[] } {
  const live = domains.filter((domain) => !domain.retired_at);
  const ids = new Set(live.map((domain) => domain.id));
  const byDomain = new Map<string, DocSetSummary[]>();
  const other: DocSetSummary[] = [];
  for (const set of sets) {
    if (set.scopeKind === "topic" && set.scopeId && ids.has(set.scopeId)) byDomain.set(set.scopeId, [...(byDomain.get(set.scopeId) ?? []), set]);
    else other.push(set);
  }
  const roots = buildDomainTree(live).map((root) => prune(root, byDomain)).filter((root): root is DocsTreeNode => root !== null);
  return { roots, other };
}
