import { describe, expect, it } from "vitest";
import { type ClaimProgress, dayKey, DEFAULT_EASE, isDue, levelCounts, levelLabel, nextProgress } from "./levels";

const DAY = 24 * 60 * 60 * 1000;
const monday = new Date("2026-11-02T09:00:00.000Z");
const at = (base: Date, days: number, hours = 0) => new Date(base.getTime() + days * DAY + hours * 60 * 60 * 1000);
const daysUntil = (progress: ClaimProgress, from: Date) => (Date.parse(progress.dueAt) - from.getTime()) / DAY;

// Answers in order, each at its own moment, from a claim never answered
function play(answers: [result: "right" | "partly" | "wrong", when: Date][], timeZone = "UTC") {
  let progress: ClaimProgress | null = null;
  for (const [result, when] of answers) progress = nextProgress(progress, result, when, timeZone);
  return progress!;
}

describe("the levels table", () => {
  it("New: never answered, due now", () => {
    expect(isDue(null, monday)).toBe(true);
    expect(levelCounts(["a"], new Map())).toEqual({ new: 1, familiar: 0, known: 0, learned: 0 });
    expect(levelLabel(0)).toBe("New");
  });

  it("Familiar: one correct answer, next review in 1 day", () => {
    const progress = play([["right", monday]]);
    expect(progress).toEqual({ level: 1, ease: DEFAULT_EASE, dueAt: at(monday, 1).toISOString(), lastSeenAt: monday.toISOString() });
    expect(levelLabel(progress.level)).toBe("Familiar");
    expect(isDue(progress, at(monday, 0, 23))).toBe(false);
    expect(isDue(progress, at(monday, 1))).toBe(true);
  });

  it("Known: correct again on a later day, next review in 4 days", () => {
    const tuesday = at(monday, 1);
    const progress = play([["right", monday], ["right", tuesday]]);
    expect(progress.level).toBe(2);
    expect(levelLabel(progress.level)).toBe("Known");
    expect(daysUntil(progress, tuesday)).toBe(4);
  });

  it("Learned: correct a third time on a later day, next review in 14 days", () => {
    const saturday = at(monday, 5);
    const progress = play([["right", monday], ["right", at(monday, 1)], ["right", saturday]]);
    expect(progress.level).toBe(3);
    expect(levelLabel(progress.level)).toBe("Learned");
    expect(daysUntil(progress, saturday)).toBe(14);
  });

  it("Learned, then 30 days for every later correct answer", () => {
    const review = at(monday, 19);
    const progress = play([["right", monday], ["right", at(monday, 1)], ["right", at(monday, 5)], ["right", review]]);
    expect(progress.level).toBe(3);
    expect(daysUntil(progress, review)).toBe(30);
    const again = at(review, 30);
    expect(daysUntil(nextProgress(progress, "right", again), again)).toBe(30);
  });
});

describe("wrong answers", () => {
  it("drop one level and make the claim due now", () => {
    const thursday = at(monday, 3);
    const known = play([["right", monday], ["right", at(monday, 1)]]);
    const dropped = nextProgress(known, "wrong", thursday);
    expect(dropped.level).toBe(1);
    expect(dropped.dueAt).toBe(thursday.toISOString());
    expect(isDue(dropped, thursday)).toBe(true);
  });

  it("drop Learned to Known", () => {
    const learned = play([["right", monday], ["right", at(monday, 1)], ["right", at(monday, 5)]]);
    expect(nextProgress(learned, "wrong", at(monday, 20)).level).toBe(2);
  });

  it("never go below New", () => {
    const first = nextProgress(null, "wrong", monday);
    expect(first).toMatchObject({ level: 0, dueAt: monday.toISOString() });
    expect(nextProgress(first, "wrong", at(monday, 1)).level).toBe(0);
  });

  it("keep the ease for a later schedule", () => {
    expect(nextProgress({ level: 2, ease: 2.1, dueAt: monday.toISOString(), lastSeenAt: monday.toISOString() }, "wrong", at(monday, 4)).ease).toBe(2.1);
  });
});

describe("partly right", () => {
  it("keeps the level and comes back in 1 day", () => {
    const thursday = at(monday, 3);
    const known = play([["right", monday], ["right", at(monday, 1)]]);
    const partly = nextProgress(known, "partly", thursday);
    expect(partly.level).toBe(2);
    expect(daysUntil(partly, thursday)).toBe(1);
  });

  it("leaves a new claim New, due tomorrow", () => {
    const partly = nextProgress(null, "partly", monday);
    expect(partly.level).toBe(0);
    expect(daysUntil(partly, monday)).toBe(1);
  });
});

describe("same-day repeats", () => {
  it("do not move a claim up twice in one day", () => {
    const later = at(monday, 0, 6);
    const progress = play([["right", monday], ["right", later]]);
    expect(progress.level).toBe(1);
    expect(daysUntil(progress, later)).toBe(1);
  });

  it("never pull the next review closer", () => {
    const learned = play([["right", monday], ["right", at(monday, 1)], ["right", at(monday, 5)], ["right", at(monday, 19)]]);
    const sameDay = at(monday, 19, 2);
    const repeat = nextProgress(learned, "right", sameDay);
    expect(repeat.level).toBe(3);
    expect(repeat.dueAt).toBe(learned.dueAt);
  });

  it("let a claim back to Familiar after a wrong answer the same day", () => {
    const progress = play([["wrong", monday], ["right", at(monday, 0, 1)]]);
    expect(progress.level).toBe(1);
  });

  it("count days in the person's time zone", () => {
    // 22:00 and 03:00 UTC fall on two days in UTC but the same afternoon and evening in Denver
    const evening = new Date("2026-11-03T03:00:00.000Z");
    const lateEvening = new Date("2026-11-03T06:00:00.000Z");
    const first = nextProgress(null, "right", new Date("2026-11-02T22:00:00.000Z"));
    expect(nextProgress(first, "right", evening, "UTC").level).toBe(2);
    expect(nextProgress(first, "right", evening, "America/Denver").level).toBe(1);
    expect(dayKey(lateEvening, "America/Denver")).toBe("2026-11-02");
    expect(dayKey(lateEvening, "Not/AZone")).toBe("2026-11-03");
  });
});

it("counts each claim once at its level", () => {
  const progress = new Map([["a", { level: 1 as const }], ["b", { level: 3 as const }], ["c", { level: 0 as const }]]);
  expect(levelCounts(["a", "a", "b", "c", "d"], progress)).toEqual({ new: 2, familiar: 1, known: 0, learned: 1 });
});
