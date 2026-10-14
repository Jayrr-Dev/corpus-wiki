import { describe, expect, it } from "vitest";
import { unitsOnlyFrom } from "./unitsOnlyFrom";

describe("unitsOnlyFrom", () => {
  it("picks units every citation of which is in the file", () => {
    const file = new Set(["p1", "p2"]);
    const units = [
      { id: "only-file", revisionId: "r", passageIds: ["p1", "p2"] },
      { id: "also-other", revisionId: "r", passageIds: ["p1", "x9"] },
      { id: "other", revisionId: "r", passageIds: ["x9"] },
      { id: "person", revisionId: "r", passageIds: [] },
    ];
    expect(unitsOnlyFrom(file, units).map((unit) => unit.id)).toEqual(["only-file"]);
  });
});
