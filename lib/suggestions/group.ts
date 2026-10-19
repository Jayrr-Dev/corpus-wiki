import { createHash } from "node:crypto";
import { cosine } from "@/lib/knowledge/similarity";

// =====================================================================
// GROUP RELATED KNOWLEDGE (no AI): the first step of an article
// suggestion run. Units that no article cites are grouped by average-link
// agglomeration over their embeddings, nudged by the other signals we
// store: unit links, shared subject entities, a shared domain and a
// shared source. Only groups big enough for an article go to the AI.
// Pure and deterministic: the same input always gives the same groups.
// =====================================================================

export type GroupUnit = { id: string; revisionId: string; vector: readonly number[]; domainIds: string[]; rootDomainId: string | null; entityIds: string[]; sourceIds: string[] };
export type GroupLink = { from: string; to: string; type: string };
export type GroupSignals = { cohesion: number; links: number; sharedEntityIds: string[]; sharedDomainIds: string[]; sharedSources: number };
export type UnitGroup = { key: string; unitIds: string[]; revisionIds: string[]; signals: GroupSignals };
export type Grouping = { groups: UnitGroup[]; ungrouped: string[] };

export const GROUPING = {
  // Average affinity two groups need to join. Same-topic claims score 0.78–0.91, unrelated ones about 0.56.
  joinAt: 0.72,
  minSize: 3,
  maxSize: 40,
  // Larger sets are grouped per root domain, so the O(n³) clustering stays fast
  partitionAbove: 400,
};

// Bonuses on top of cosine similarity. They only apply to pairs that are already
// somewhat alike, so a link or a shared entity never joins unrelated knowledge.
const BONUS_FLOOR = 0.5;
const LINK_BONUS = 0.08;
const ENTITY_BONUS = 0.04;
const ENTITY_BONUS_MAX = 0.08;
const DOMAIN_BONUS = 0.04;
const SOURCE_BONUS = 0.03;

const shares = (a: readonly string[], b: readonly string[]) => a.filter((id) => b.includes(id)).length;
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// "contradicts" still means the same subject; ordering and replacement edges do not
function linkCounts(type: string): boolean {
  return !/supersede|before|after|next|follow|sequence|preced/i.test(type);
}

export function pairAffinity(a: GroupUnit, b: GroupUnit, linked: boolean): { affinity: number; semantic: number } {
  const semantic = cosine(a.vector, b.vector);
  if (semantic < BONUS_FLOOR) return { affinity: semantic, semantic };
  const bonus = (linked ? LINK_BONUS : 0)
    + Math.min(ENTITY_BONUS_MAX, ENTITY_BONUS * shares(a.entityIds, b.entityIds))
    + (shares(a.domainIds, b.domainIds) ? DOMAIN_BONUS : 0)
    + (shares(a.sourceIds, b.sourceIds) ? SOURCE_BONUS : 0);
  return { affinity: Math.min(1, semantic + bonus), semantic };
}

// The identity of a group: its units at their revisions
export function groupKey(units: readonly { id: string; revisionId: string }[]): string {
  const parts = units.map((unit) => `${unit.id}:${unit.revisionId}`).sort();
  return createHash("sha256").update(parts.join(",")).digest("hex").slice(0, 24);
}

// Average-link agglomeration that stops at the join threshold and never builds a
// group over maxSize. Cluster-to-cluster averages are kept up to date with the
// Lance–Williams update, so each merge costs O(k) after an O(k²) search.
function cluster(affinity: number[][], joinAt: number, maxSize: number): number[][] {
  const groups: (number[] | null)[] = affinity.map((_, index) => [index]);
  const average = affinity.map((row) => [...row]);
  for (;;) {
    let best = -Infinity, left = -1, right = -1;
    for (let a = 0; a < groups.length; a++) {
      const first = groups[a];
      if (!first) continue;
      for (let b = a + 1; b < groups.length; b++) {
        const second = groups[b];
        if (!second || first.length + second.length > maxSize) continue;
        if (average[a]![b]! > best + 1e-12) { best = average[a]![b]!; left = a; right = b; }
      }
    }
    if (left < 0 || best < joinAt) break;
    const first = groups[left]!, second = groups[right]!;
    for (let other = 0; other < groups.length; other++) {
      if (!groups[other] || other === left || other === right) continue;
      const merged = (first.length * average[left]![other]! + second.length * average[right]![other]!) / (first.length + second.length);
      average[left]![other] = merged;
      average[other]![left] = merged;
    }
    groups[left] = [...first, ...second].sort((x, y) => x - y);
    groups[right] = null;
  }
  return groups.filter((group): group is number[] => Boolean(group));
}

// Ids found on at least half of the group's units (and on two or more)
function common(lists: readonly string[][]): string[] {
  const counts = new Map<string, number>();
  for (const list of lists) for (const id of new Set(list)) counts.set(id, (counts.get(id) ?? 0) + 1);
  const needed = Math.max(2, Math.ceil(lists.length / 2));
  return [...counts].filter(([, count]) => count >= needed).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
}

function groupPartition(units: GroupUnit[], linked: ReadonlySet<string>, options: typeof GROUPING): Grouping {
  const semantic: number[][] = units.map(() => new Array<number>(units.length).fill(1));
  const affinity: number[][] = units.map(() => new Array<number>(units.length).fill(1));
  for (let a = 0; a < units.length; a++) for (let b = a + 1; b < units.length; b++) {
    const score = pairAffinity(units[a]!, units[b]!, linked.has(pairKey(units[a]!.id, units[b]!.id)));
    affinity[a]![b] = affinity[b]![a] = score.affinity;
    semantic[a]![b] = semantic[b]![a] = score.semantic;
  }
  const groups: UnitGroup[] = [];
  const ungrouped: string[] = [];
  for (const members of cluster(affinity, options.joinAt, options.maxSize)) {
    const list = members.map((index) => units[index]!);
    if (list.length < options.minSize) { ungrouped.push(...list.map((unit) => unit.id)); continue; }
    let pairs = 0, total = 0, links = 0;
    for (let x = 0; x < members.length; x++) for (let y = x + 1; y < members.length; y++) {
      pairs++;
      total += semantic[members[x]!]![members[y]!]!;
      if (linked.has(pairKey(list[x]!.id, list[y]!.id))) links++;
    }
    const sources = common(list.map((unit) => unit.sourceIds));
    groups.push({
      key: groupKey(list),
      unitIds: list.map((unit) => unit.id),
      revisionIds: list.map((unit) => unit.revisionId),
      signals: { cohesion: Math.round((pairs ? total / pairs : 1) * 1000) / 1000, links, sharedEntityIds: common(list.map((unit) => unit.entityIds)),
        sharedDomainIds: common(list.map((unit) => unit.domainIds)), sharedSources: sources.length },
    });
  }
  return { groups, ungrouped };
}

// Split a large set by root domain (units without one form their own part), then
// into fixed-size chunks if one domain alone is still too large
function partitions(units: GroupUnit[], limit: number): GroupUnit[][] {
  if (units.length <= limit) return [units];
  const byRoot = new Map<string, GroupUnit[]>();
  for (const unit of units) byRoot.set(unit.rootDomainId ?? "", [...(byRoot.get(unit.rootDomainId ?? "") ?? []), unit]);
  return [...byRoot.keys()].sort().flatMap((root) => {
    const part = byRoot.get(root)!;
    const chunks: GroupUnit[][] = [];
    for (let index = 0; index < part.length; index += limit) chunks.push(part.slice(index, index + limit));
    return chunks;
  });
}

export function groupUnits(units: readonly GroupUnit[], links: readonly GroupLink[], options: Partial<typeof GROUPING> = {}): Grouping {
  const settings = { ...GROUPING, ...options };
  const sorted = [...units].sort((a, b) => a.id.localeCompare(b.id));
  const linked = new Set(links.filter((link) => link.from !== link.to && linkCounts(link.type)).map((link) => pairKey(link.from, link.to)));
  const result: Grouping = { groups: [], ungrouped: [] };
  for (const part of partitions(sorted, settings.partitionAbove)) {
    const { groups, ungrouped } = groupPartition(part, linked, settings);
    result.groups.push(...groups);
    result.ungrouped.push(...ungrouped);
  }
  result.groups.sort((a, b) => b.unitIds.length - a.unitIds.length || a.key.localeCompare(b.key));
  return result;
}

// A group someone already dismissed comes back only when it has changed: at least
// a fifth of its units, at their current revisions, are new to that suggestion
export const DISMISSED_OVERLAP = 0.8;
export function withoutDismissed(groups: readonly UnitGroup[], dismissed: readonly { unitIds: string[]; revisionIds: string[] }[]): UnitGroup[] {
  const seen = dismissed.map((item) => new Set(item.unitIds.map((id, index) => `${id}:${item.revisionIds[index]}`)));
  return groups.filter((group) => {
    const pairs = group.unitIds.map((id, index) => `${id}:${group.revisionIds[index]}`);
    return !seen.some((set) => pairs.filter((pair) => set.has(pair)).length / pairs.length >= DISMISSED_OVERLAP);
  });
}
