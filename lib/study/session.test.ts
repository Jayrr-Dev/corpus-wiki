import { expect, it } from "vitest";
import { claimStandings, pickQueue, summarizeSets, testItems } from "./session";
import type { StudyItemRow, StudyProgressRow, StudySetsData } from "./types";

const now = new Date("2026-11-02T09:00:00Z");
const item = (id: string, setId: string, unitId: string, extra: Partial<StudyItemRow> = {}): StudyItemRow => ({ id, setId, unitId, revisionId: `r-${unitId}`, kind: "flashcard", prompt: "Q", answer: "A", choices: null, explanation: "", stale: false, ...extra });
const set = (id: string) => ({ id, title: id, scopeKind: "topic" as const, scopeId: "t", coverage: 100 as const, custom: false, types: ["flashcard" as const], introVideo: false, createdAt: "2026-11-01T00:00:00Z" });

const data: StudySetsData = {
  sets: [set("s1"), set("s2")],
  items: [item("i1", "s1", "a"), item("i2", "s1", "a", { kind: "short_answer" }), item("i3", "s1", "b"), item("i4", "s1", "c"), item("i5", "s2", "c"), item("i6", "s2", "d", { stale: true })],
  claims: ["a", "b", "c", "d"].map((unitId) => ({ unitId, title: null, content: `claim ${unitId}`, retired: false })),
  progress: [
    { unitId: "a", level: 1, ease: 2.5, dueAt: "2026-11-03T09:00:00Z", lastSeenAt: "2026-11-02T08:00:00Z" },
    { unitId: "b", level: 3, ease: 2.5, dueAt: "2026-11-01T09:00:00Z", lastSeenAt: "2026-10-18T09:00:00Z" },
  ],
};

it("summarizes each set: coverage reached, due claims and levels", () => {
  const { sets, due } = summarizeSets(data, now);
  expect(sets[0]).toMatchObject({ id: "s1", items: 4, claims: 3, practiced: 2, practicedPct: 67, due: 2, stale: 0, levels: { new: 1, familiar: 1, known: 0, learned: 1 } });
  expect(sets[1]).toMatchObject({ id: "s2", claims: 2, practiced: 0, practicedPct: 0, due: 2, stale: 1 });
  // Due today counts each claim once across sets, and leaves stale questions out
  expect(due).toBe(2);
});

it("queues one question per due claim, never answered first, then the longest overdue", () => {
  const queue = pickQueue(data.items, data.progress, now, { random: () => 0 });
  expect(queue.map((row) => row.unitId)).toEqual(["c", "b"]);
  expect(pickQueue(data.items, data.progress, now, { all: true, random: () => 0.99 }).map((row) => row.id)).toEqual(["i5", "i3", "i2"]);
  expect(pickQueue(data.items, data.progress, now, { limit: 1 })).toHaveLength(1);
});

it("lists a set's claims with level and next review", () => {
  expect(claimStandings(data, "s1")).toEqual([
    { unitId: "c", title: null, content: "claim c", level: 0, dueAt: null },
    { unitId: "a", title: null, content: "claim a", level: 1, dueAt: "2026-11-03T09:00:00Z" },
    { unitId: "b", title: null, content: "claim b", level: 3, dueAt: "2026-11-01T09:00:00Z" },
  ]);
});

it("testItems: the questions of the chosen sets at the chosen levels, stale ones left out", () => {
  const progress: StudyProgressRow[] = [{ unitId: "a", level: 3, ease: 2.5, dueAt: "2026-12-01T00:00:00Z", lastSeenAt: "2026-11-01T00:00:00Z" }, { unitId: "b", level: 1, ease: 2.5, dueAt: "2026-11-01T00:00:00Z", lastSeenAt: "2026-11-01T00:00:00Z" }];
  const testData: StudySetsData = { ...data, progress };
  // a is Learned, b is Familiar, c and d are New (never answered)
  expect(testItems(testData, ["s1", "s2"], ["new"]).map((row) => row.id)).toEqual(["i4", "i5"]);
  expect(testItems(testData, ["s1"], ["learned", "familiar"]).map((row) => row.id)).toEqual(["i1", "i2", "i3"]);
  expect(testItems(testData, ["s2"], ["learned", "familiar", "known", "new"]).map((row) => row.id)).toEqual(["i5"]);
  expect(testItems(testData, [], ["new"])).toEqual([]);
});

it("testItems: only the chosen question types come up", () => {
  const typed: StudySetsData = { ...data, items: [item("t1", "s1", "a", { kind: "flashcard" }), item("t2", "s1", "a", { kind: "multiple_choice" }), item("t3", "s1", "b", { kind: "short_answer" })] };
  expect(testItems(typed, ["s1"], ["learned", "familiar"], ["multiple_choice", "short_answer"]).map((row) => row.id)).toEqual(["t2", "t3"]);
  expect(testItems(typed, ["s1"], ["learned", "familiar"], ["flashcard"]).map((row) => row.id)).toEqual(["t1"]);
  expect(testItems(typed, ["s1"], ["learned", "familiar"], []).map((row) => row.id)).toEqual([]);
});
