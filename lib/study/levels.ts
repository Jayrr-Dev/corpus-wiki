// =====================================================================
// STUDY LEVELS AND SPACING (docs/knowledge-modules-plan.md, section 1):
// a Leitner box per claim, per person. The levels are the boxes.
//
//   Level     Reached when                           Next review
//   New       never answered                         now
//   Familiar  1 correct answer                       1 day
//   Known     correct again, on a later day          4 days
//   Learned   correct a third time, on a later day   14 days, then 30
//
// A wrong answer drops one level and makes the claim due now. "Partly
// right" keeps the level and brings the claim back in 1 day. A correct
// answer on the same day as the last one keeps the level (and never pulls
// the next review closer). `ease` is carried for a later SM-2 schedule.
// Pure: no clock, no database; the caller passes `now` and the time zone.
// =====================================================================

export const LEVELS = ["new", "familiar", "known", "learned"] as const;
export type LevelKey = (typeof LEVELS)[number];
export type Level = 0 | 1 | 2 | 3;
export const LEVEL_LABELS: Record<LevelKey, string> = { new: "New", familiar: "Familiar", known: "Known", learned: "Learned" };
export const levelKey = (level: number): LevelKey => LEVELS[Math.min(3, Math.max(0, Math.trunc(level)))]!;
export const levelLabel = (level: number): string => LEVEL_LABELS[levelKey(level)];

export type StudyResult = "right" | "partly" | "wrong";
export const STUDY_RESULTS = ["right", "partly", "wrong"] as const;

// One person's standing on one claim (study_progress); null means never answered (New, due now)
export type ClaimProgress = { level: Level; ease: number; dueAt: string; lastSeenAt: string };

export const DEFAULT_EASE = 2.5;
const DAY_MS = 24 * 60 * 60 * 1000;
// Days until the next review once a level is reached; Learned again on a later day waits 30
export const LEVEL_DAYS: Record<Level, number> = { 0: 0, 1: 1, 2: 4, 3: 14 };
export const LEARNED_AGAIN_DAYS = 30;
export const PARTLY_DAYS = 1;

const addDays = (now: Date, days: number) => new Date(now.getTime() + days * DAY_MS).toISOString();

// The calendar day of a moment in a time zone, as YYYY-MM-DD (an unknown zone counts as UTC)
export function dayKey(moment: Date | string, timeZone = "UTC"): string {
  const date = typeof moment === "string" ? new Date(moment) : moment;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export const sameDay = (a: Date | string, b: Date | string, timeZone = "UTC") => dayKey(a, timeZone) === dayKey(b, timeZone);

// NEXT PROGRESS: the claim's level and next review after one answer
export function nextProgress(previous: ClaimProgress | null, result: StudyResult, now: Date, timeZone = "UTC"): ClaimProgress {
  const level: Level = previous?.level ?? 0;
  const ease = previous?.ease ?? DEFAULT_EASE;
  const seen = now.toISOString();
  if (result === "wrong") return { level: Math.max(0, level - 1) as Level, ease, dueAt: seen, lastSeenAt: seen };
  if (result === "partly") return { level, ease, dueAt: addDays(now, PARTLY_DAYS), lastSeenAt: seen };
  // The first correct answer always makes a claim Familiar
  if (level === 0) return { level: 1, ease, dueAt: addDays(now, LEVEL_DAYS[1]), lastSeenAt: seen };
  // Moving up needs a later day than the last answer: a same-day repeat keeps the level
  if (previous && sameDay(previous.lastSeenAt, now, timeZone)) {
    const later = addDays(now, LEVEL_DAYS[level]);
    return { level, ease, dueAt: Date.parse(previous.dueAt) > Date.parse(later) ? new Date(previous.dueAt).toISOString() : later, lastSeenAt: seen };
  }
  if (level === 3) return { level: 3, ease, dueAt: addDays(now, LEARNED_AGAIN_DAYS), lastSeenAt: seen };
  const up = (level + 1) as Level;
  return { level: up, ease, dueAt: addDays(now, LEVEL_DAYS[up]), lastSeenAt: seen };
}

// Due when never answered or when its review time has come
export function isDue(progress: Pick<ClaimProgress, "dueAt"> | null | undefined, now: Date): boolean {
  return !progress || Date.parse(progress.dueAt) <= now.getTime();
}

// How many claims sit at each level; claims with no progress are New
export function levelCounts(unitIds: readonly string[], progress: ReadonlyMap<string, { level: number }>): Record<LevelKey, number> {
  const counts: Record<LevelKey, number> = { new: 0, familiar: 0, known: 0, learned: 0 };
  for (const unitId of new Set(unitIds)) counts[levelKey(progress.get(unitId)?.level ?? 0)]++;
  return counts;
}
