import { isDue, levelCounts, levelKey, type LevelKey } from "./levels";
import type { StudyItemRow, StudyKind, StudyProgressRow, StudySetRow, StudySetsData } from "./types";
import { STUDY_KINDS } from "./types";

// =====================================================================
// STUDY SESSIONS AND SUMMARIES: pure views over read_study_sets for the
// list (/study), a set's Practice and Progress tabs, and Start review.
// =====================================================================

export type SetSummary = StudySetRow & {
  items: number;
  claims: number;
  // claims the person has answered at least once (coverage reached)
  practiced: number;
  practicedPct: number;
  due: number;
  stale: number;
  levels: Record<LevelKey, number>;
};

const progressMap = (progress: readonly StudyProgressRow[]) => new Map(progress.map((row) => [row.unitId, row]));

// Each set with its coverage reached, due count and levels; `due` counts each claim once across every set
export function summarizeSets(data: StudySetsData, now: Date): { sets: SetSummary[]; due: number } {
  const progress = progressMap(data.progress);
  const sets = data.sets.map((set) => {
    const items = data.items.filter((item) => item.setId === set.id);
    const unitIds = [...new Set(items.map((item) => item.unitId))];
    const practiced = unitIds.filter((unitId) => progress.has(unitId)).length;
    return {
      ...set, items: items.length, claims: unitIds.length, practiced,
      practicedPct: unitIds.length ? Math.round((practiced / unitIds.length) * 100) : 0,
      due: unitIds.filter((unitId) => isDue(progress.get(unitId), now)).length,
      stale: items.filter((item) => item.stale).length,
      levels: levelCounts(unitIds, progress),
    };
  });
  const due = new Set(data.items.filter((item) => !item.stale && isDue(progress.get(item.unitId), now)).map((item) => item.unitId)).size;
  return { sets, due };
}

export const SESSION_LIMIT = 20;

// PRACTICE QUEUE: one current question per claim that is due, the longest overdue first (never-answered
// claims before answered ones). With `all`, every claim comes up, due or not. Stale items are left out
// until they are rebuilt. `random` picks which question tests each claim and is injectable for tests.
export function pickQueue(items: readonly StudyItemRow[], progress: readonly StudyProgressRow[], now: Date, options: { all?: boolean; limit?: number; random?: () => number } = {}): StudyItemRow[] {
  const levels = progressMap(progress);
  const random = options.random ?? Math.random;
  const byClaim = new Map<string, StudyItemRow[]>();
  for (const item of items) {
    if (item.stale) continue;
    if (!options.all && !isDue(levels.get(item.unitId), now)) continue;
    byClaim.set(item.unitId, [...(byClaim.get(item.unitId) ?? []), item]);
  }
  const dueAt = (unitId: string) => { const row = levels.get(unitId); return row ? Date.parse(row.dueAt) : Number.NEGATIVE_INFINITY; };
  return [...byClaim.entries()]
    .sort(([a], [b]) => dueAt(a) - dueAt(b))
    .slice(0, options.limit ?? SESSION_LIMIT)
    .map(([, choices]) => choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]!);
}

// TEST QUESTIONS: every question from the chosen sets whose claim sits at one of the chosen levels and whose type is chosen (from the pool, nothing written).
// Due or not, a claim comes up once per question pick; the caller takes one per claim with pickQueue.
export function testItems(data: StudySetsData, setIds: readonly string[], levels: readonly LevelKey[], kinds: readonly StudyKind[] = STUDY_KINDS): StudyItemRow[] {
  const sets = new Set(setIds);
  const wanted = new Set(levels);
  const wantedKinds = new Set(kinds);
  const progress = progressMap(data.progress);
  return data.items.filter((item) => sets.has(item.setId) && !item.stale && wantedKinds.has(item.kind) && wanted.has(levelKey(progress.get(item.unitId)?.level ?? 0)));
}

export type ClaimStanding ={ unitId: string; title: string | null; content: string; level: number; dueAt: string | null };

// PROGRESS TAB: every claim a set tests with the person's level and next review (null = now, never answered)
export function claimStandings(data: StudySetsData, setId: string): ClaimStanding[] {
  const levels = progressMap(data.progress);
  const unitIds = new Set(data.items.filter((item) => item.setId === setId).map((item) => item.unitId));
  return data.claims.filter((claim) => unitIds.has(claim.unitId)).map((claim) => {
    const row = levels.get(claim.unitId);
    return { unitId: claim.unitId, title: claim.title, content: claim.content, level: row?.level ?? 0, dueAt: row?.dueAt ?? null };
  }).sort((a, b) => a.level - b.level || (a.dueAt ?? "").localeCompare(b.dueAt ?? "") || a.content.localeCompare(b.content));
}
