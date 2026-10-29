import type { Tables } from "@/lib/database/types";
import { buildDomainTree, type DomainNode } from "@/lib/domains/tree";
import type { SetSummary } from "./session";

// =====================================================================
// STUDY TREE: the study list (/study) laid out on the domain tree. Topic
// sets hang on their domain; only branches that hold a set are kept, so a
// large tree stays small here. Sets from other sources, or on a retired
// topic, come back apart as `other`.
// =====================================================================

export type StudyTotals = { sets: number; claims: number; practiced: number; due: number };

// One topic with the sets on it and every kept topic under it; `totals` covers the whole branch
export type StudyTreeNode = { id: string; name: string; depth: number; sets: SetSummary[]; children: StudyTreeNode[]; totals: StudyTotals };

const NO_TOTALS: StudyTotals = { sets: 0, claims: 0, practiced: 0, due: 0 };

const addTotals = (a: StudyTotals, b: StudyTotals): StudyTotals => ({ sets: a.sets + b.sets, claims: a.claims + b.claims, practiced: a.practiced + b.practiced, due: a.due + b.due });

// The share of a branch's claims practiced at least once, as a whole percent
export const practicedPct = (totals: StudyTotals) => (totals.claims ? Math.round((totals.practiced / totals.claims) * 100) : 0);

function setTotals(sets: readonly SetSummary[]): StudyTotals {
  return sets.reduce((sum, set) => addTotals(sum, { sets: 1, claims: set.claims, practiced: set.practiced, due: set.due }), NO_TOTALS);
}

// Keeps a domain when it or a topic under it holds a set
function prune(node: DomainNode, depth: number, byDomain: ReadonlyMap<string, SetSummary[]>): StudyTreeNode | null {
  const children = node.children.map((child) => prune(child, depth + 1, byDomain)).filter((child): child is StudyTreeNode => child !== null);
  const sets = byDomain.get(node.id) ?? [];
  if (!sets.length && !children.length) return null;
  const totals = children.reduce((sum, child) => addTotals(sum, child.totals), setTotals(sets));
  return { id: node.id, name: node.name, depth, sets, children, totals };
}

// STUDY TREE: topic sets on their live domains; everything else in `other`
export function studyTree(domains: readonly Tables<"domains">[], sets: readonly SetSummary[]): { roots: StudyTreeNode[]; other: SetSummary[] } {
  const live = domains.filter((domain) => !domain.retired_at);
  const ids = new Set(live.map((domain) => domain.id));
  const byDomain = new Map<string, SetSummary[]>();
  const other: SetSummary[] = [];
  for (const set of sets) {
    if (set.scopeKind === "topic" && set.scopeId && ids.has(set.scopeId)) byDomain.set(set.scopeId, [...(byDomain.get(set.scopeId) ?? []), set]);
    else other.push(set);
  }
  const roots = buildDomainTree(live).map((root) => prune(root, 0, byDomain)).filter((root): root is StudyTreeNode => root !== null);
  return { roots, other };
}

// FILTER: topics whose name (or a set's title) holds the query keep their whole branch; their parents stay as the path
export function filterStudyTree(nodes: readonly StudyTreeNode[], query: string): StudyTreeNode[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...nodes];
  const matches = (node: StudyTreeNode) => node.name.toLocaleLowerCase().includes(needle) || node.sets.some((set) => set.title.toLocaleLowerCase().includes(needle));
  return nodes.flatMap((node) => {
    if (matches(node)) return [node];
    const children = filterStudyTree(node.children, query);
    return children.length ? [{ ...node, sets: [], children }] : [];
  });
}
