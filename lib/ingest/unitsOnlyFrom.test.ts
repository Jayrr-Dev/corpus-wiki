import { describe, expect, it } from "vitest";
import { unitsOnlyFrom, unitsPartlyFrom } from "./unitsOnlyFrom";

const FILE = new Set(["p1", "p2"]);
const UNITS = [
  { id: "only-file", revisionId: "r", passageIds: ["p1", "p2"] },
  { id: "also-other", revisionId: "r", passageIds: ["p1", "x9"] },
  { id: "other", revisionId: "r", passageIds: ["x9"] },
  { id: "person", revisionId: "r", passageIds: [] },
];

describe("unitsOnlyFrom", () => {
  it("picks units every citation of which is in the file", () => {
    expect(unitsOnlyFrom(FILE, UNITS).map((unit) => unit.id)).toEqual(["only-file"]);
  });
});

describe("unitsPartlyFrom", () => {
  it("picks units citing the file and other evidence, keeping only the other citations", () => {
    expect(unitsPartlyFrom(FILE, UNITS)).toEqual([{ ...UNITS[1], remainingPassageIds: ["x9"] }]);
  });
});
