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

  it("keeps only clusters holding a focus unit", () => {
    expect(ids(findDuplicateClusters(units, new Set(["u4"])))).toEqual([["u3", "u4"]]);
  });
});

describe("dedupeAnswerToActions", () => {
  const batch = [units[2]!, units[3]!, units[0]!];

  it("merges into the kept unit, revising it first when the wording gains a detail", () => {
    const actions = dedupeAnswerToActions({ groups: [{ keep: "U1", duplicates: ["U2"], content: units[3]!.content, reason: "" }] }, batch);
    expect(actions.map((a) => a.type)).toEqual(["revise_claim", "merge_duplicates"]);
    expect(actions[0]).toMatchObject({ targetId: "u3", expectedRevisionId: "r-u3", passageIds: ["p-u3", "p-u4"] });
    expect(actions[1]).toMatchObject({ targetId: "u3", input: { duplicateUnitIds: ["u4"] } });
  });

  it("skips the revise when the wording does not change", () => {
    const actions = dedupeAnswerToActions({ groups: [{ keep: "U1", duplicates: ["U2"], content: ` ${units[2]!.content.toUpperCase()} `, reason: "" }] }, batch);
    expect(actions.map((a) => a.type)).toEqual(["merge_duplicates"]);
  });

  it("drops unknown refs, self merges, empty groups and units already used", () => {
    const actions = dedupeAnswerToActions({
      groups: [
        { keep: "U9", duplicates: ["U1"], content: null, reason: "" },
        { keep: "U1", duplicates: ["U1", "U7"], content: null, reason: "" },
        { keep: "u1", duplicates: ["U2"], content: null, reason: "" },
        { keep: "U3", duplicates: ["U2"], content: null, reason: "" },
      ],
    }, batch);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: "merge_duplicates", targetId: "u3", input: { duplicateUnitIds: ["u4"] } });
  });
});
