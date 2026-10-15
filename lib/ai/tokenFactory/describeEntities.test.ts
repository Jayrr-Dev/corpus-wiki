import { describe, expect, it } from "vitest";
import { cleanDescription, DESCRIPTION_MAX_CHARS, describeAnswerToRows, type EntityEvidence } from "./describeEntities";

const entity = (entityId: string): EntityEvidence => ({ entityId, type: "org", name: entityId, aliases: [], claims: ["A claim."], passages: [] });

describe("describeAnswerToRows", () => {
  it("maps refs to ids and drops unknown refs, empty answers and repeats", () => {
    const rows = describeAnswerToRows(
      { descriptions: [{ ref: "e1", description: "  A \t supplier. " }, { ref: "E2", description: " " }, { ref: "E9", description: "Ghost." }, { ref: "E1", description: "Again." }] },
      [entity("a"), entity("b")],
    );
    expect(rows).toEqual([{ entityId: "a", description: "A supplier." }]);
  });
});

describe("cleanDescription", () => {
  it("cuts a long answer at the last sentence that fits", () => {
    const text = `${"Word ".repeat(40).trim()}. ${"More ".repeat(60).trim()}.`;
    const cleaned = cleanDescription(text);
    expect(cleaned.length).toBeLessThanOrEqual(DESCRIPTION_MAX_CHARS);
    expect(cleaned.endsWith(".")).toBe(true);
  });
});
