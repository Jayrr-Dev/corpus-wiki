import { describe, expect, it } from "vitest";
import { dedupeAnswerToActions, type DedupeUnit, findDuplicateClusters } from "./dedupePass";

// =====================================================================
// FIXTURE: the real failure, one handbook ingested twice. u1/u2 restate
// the same inspection policy, u3/u4 the same hearing rule (u4 adds a
// detail), u5 is unrelated, u6 is too short to judge by overlap.
// =====================================================================

const unit = (unitId: string, content: string, passageIds = [`p-${unitId}`]): DedupeUnit => ({
  unitId, revisionId: `r-${unitId}`, content, kind: "fact", epistemicStatus: "established", passageIds, createdAt: "2026-10-14T00:00:00Z",
});

const units = [
  unit("u1", "Utilitek Solutions Inc. conducts documented workplace inspections weekly on project sites and monthly at the company premises."),
  unit("u2", "Utilitek Solutions Inc. conducts documented workplace inspections to correct unsafe conditions, weekly on project sites and monthly at the company premises."),
  unit("u3", "Utilitek Solutions Inc. requires hearing protection for employees exposed to noise of 85 dB or greater."),
  unit("u4", "Utilitek Solutions Inc. requires hearing protection for employees exposed to noise of 85 dB or greater, whenever voices must be elevated."),
  unit("u5", "The Discipline Policy treats fighting and theft as Class A violations."),
  unit("u6", "Hearing protection required"),
];
const ids = (clusters: DedupeUnit[][]) => clusters.map((cluster) => cluster.map((u) => u.unitId));

describe("findDuplicateClusters", () => {
  it("groups look-alike claims and leaves unrelated and very short ones out", () => {
    expect(ids(findDuplicateClusters(units))).toEqual([["u1", "u2"], ["u3", "u4"]]);
  });

  it("includes exact short duplicates without merging unrelated short topics", () => {
    const short = [
      unit("a", "Safety meetings"),
      unit("b", "  SAFETY   meetings. "),
      unit("c", "Emergency response"),
    ];
    expect(ids(findDuplicateClusters(short))).toEqual([["a", "b"]]);
  });

  it("compares candidates across batch boundaries without dropping the last unit", () => {
    const many = Array.from({ length: 25 }, (_, i) => unit(`u${i}`, "The company conducts documented workplace inspections every week."));
    const batches = findDuplicateClusters(many);
    expect(batches.every((batch) => batch.length <= 12)).toBe(true);
    for (let i = 0; i < many.length; i++) {
      for (let j = i + 1; j < many.length; j++) {
        expect(batches.some((batch) => batch.includes(many[i]!) && batch.includes(many[j]!))).toBe(true);
      }
    }
  });
  it("keeps only clusters holding a focus unit", () => {
    expect(ids(findDuplicateClusters(units, new Set(["u4"])))).toEqual([["u3", "u4"]]);
  });
});

describe("dedupeAnswerToActions", () => {
  const batch = [units[2]!, units[3]!, units[0]!];

  it("merges into the kept unit, revising it first when the wording gains a detail", () => {
    const actions = dedupeAnswerToActions({ groups: [{ keep: "U1", duplicates: ["U2"], content: units[3]!.content, confidence: "medium", reason: "" }] }, batch);
    expect(actions.map((a) => a.type)).toEqual(["revise_claim", "merge_duplicates"]);
    expect(actions[0]).toMatchObject({ targetId: "u3", expectedRevisionId: "r-u3", passageIds: ["p-u3", "p-u4"] });
    expect(actions[1]).toMatchObject({ targetId: "u3", input: { duplicateUnitIds: ["u4"] } });
  });

  it("skips the revise when the wording does not change", () => {
    const actions = dedupeAnswerToActions({ groups: [{ keep: "U1", duplicates: ["U2"], content: ` ${units[2]!.content.toUpperCase()} `, confidence: "medium", reason: "" }] }, batch);
    expect(actions.map((a) => a.type)).toEqual(["merge_duplicates"]);
  });

  it("drops unknown refs, self merges, empty groups and units already used", () => {
    const actions = dedupeAnswerToActions({
      groups: [
        { keep: "U9", duplicates: ["U1"], content: null, confidence: "medium", reason: "" },
        { keep: "U1", duplicates: ["U1", "U7"], content: null, confidence: "medium", reason: "" },
        { keep: "u1", duplicates: ["U2"], content: null, confidence: "medium", reason: "" },
        { keep: "U3", duplicates: ["U2"], content: null, confidence: "medium", reason: "" },
      ],
    }, batch);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: "merge_duplicates", targetId: "u3", input: { duplicateUnitIds: ["u4"] } });
  });
});


describe("findDuplicateClusters with vectors", () => {
  // u1/u2 at cosine 0.97; u3 and u4 at right angles to everything
  const vectors = new Map([["r-u1", [1, 0, 0]], ["r-u2", [0.97, 0.243, 0]], ["r-u3", [0, 0, 1]], ["r-u4", [0, -1, 0]]]);

  it("groups by meaning when both units are embedded, and by words otherwise", () => {
    // u1/u2 are close in meaning; u3/u4 are far apart by vector though they share words
    expect(ids(findDuplicateClusters(units.slice(0, 4), undefined, vectors))).toEqual([["u1", "u2"]]);
  });
});

describe("auto merge", () => {
  const batch = [units[2]!, units[3]!];
  const near = new Map([["r-u3", [1, 0]], ["r-u4", [0.96, 0.28]]]);
  const far = new Map([["r-u3", [1, 0]], ["r-u4", [0.9, 0.436]]]);
  const merge = (confidence: "high" | "medium", vectors?: Map<string, number[]>) =>
    dedupeAnswerToActions({ groups: [{ keep: "U1", duplicates: ["U2"], content: null, confidence, reason: "" }] }, batch, vectors)[0]!;

  it("marks a sure merge of near-identical claims to apply without review", () => {
    expect(merge("high", near).input).toMatchObject({ autoMerge: true });
  });

  it("leaves unsure, less similar or word-only merges for a person", () => {
    expect(merge("medium", near).input).not.toHaveProperty("autoMerge");
    expect(merge("high", far).input).not.toHaveProperty("autoMerge");
    expect(merge("high").input).not.toHaveProperty("autoMerge");
  });

  it("auto merges the same text even without vectors", () => {
    const same = [units[2]!, unit("u9", ` ${units[2]!.content.toUpperCase()} `)];
    const [action] = dedupeAnswerToActions({ groups: [{ keep: "U1", duplicates: ["U2"], content: null, confidence: "high", reason: "" }] }, same);
    expect(action!.input).toMatchObject({ autoMerge: true });
  });
});
