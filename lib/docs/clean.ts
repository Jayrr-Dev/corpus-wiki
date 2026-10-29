import type { DocSetSummary } from "./types";

// =====================================================================
// DOCS CLEANUP: which doc sets Clean (/docs) retires. Sets written from
// the same source (scope kind and id) are duplicates; each group keeps one
// set and retires the rest. The keeper is the best finished set: ready over
// failed, then the newest, then the one with more pages. A set still being
// written is never retired, and its group waits until it is done.
// =====================================================================

export type DocDuplicateGroup = { keep: DocSetSummary; retire: DocSetSummary[] };

const sourceKey = (set: DocSetSummary) => `${set.scopeKind}:${set.scopeId ?? ""}`;

// Better keeper first
function compareKeepers(a: DocSetSummary, b: DocSetSummary): number {
  if (a.status !== b.status) return a.status === "ready" ? -1 : b.status === "ready" ? 1 : 0;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.pageCount !== b.pageCount) return b.pageCount - a.pageCount;
  return a.id < b.id ? -1 : 1;
}

export function planDocCleanup(sets: readonly DocSetSummary[]): DocDuplicateGroup[] {
  const bySource = new Map<string, DocSetSummary[]>();
  for (const set of sets) bySource.set(sourceKey(set), [...(bySource.get(sourceKey(set)) ?? []), set]);
  const groups: DocDuplicateGroup[] = [];
  for (const group of bySource.values()) {
    if (group.length < 2 || group.some((set) => set.status === "writing")) continue;
    const [keep, ...retire] = [...group].sort(compareKeepers);
    groups.push({ keep: keep!, retire });
  }
  return groups;
}

export const docSetsToRetire = (groups: readonly DocDuplicateGroup[]): string[] => groups.flatMap((group) => group.retire.map((set) => set.id));
