import { describe, expect, it } from "vitest";
import { type ActionTarget, buildPersonAction, initialValues, validateValues } from "./buildAction";

const TARGET: ActionTarget = {
  id: "00000000-0000-4000-8000-010000000002",
  currentRevisionId: "00000000-0000-4000-8000-0b0000000002",
  content: "Alpha's first internal release is planned for Q1 2027.",
  epistemicStatus: "established",
};

describe("buildPersonAction", () => {
  it("builds revise_claim with the revision the person saw", () => {
    const values = { ...initialValues(TARGET), content: " Alpha's first internal release is planned for Q2 2027. " };
    expect(buildPersonAction("revise", TARGET, values)).toEqual({
      type: "revise_claim",
      targetId: TARGET.id,
      expectedRevisionId: TARGET.currentRevisionId,
      input: { content: "Alpha's first internal release is planned for Q2 2027." },
      passageIds: [],
      speechAct: null,
    });
  });

  it("adds the status to a revise only when one was picked", () => {
    const values = { ...initialValues(TARGET), epistemicStatus: "disputed" as const };
    expect(buildPersonAction("revise", TARGET, values).input).toEqual({ content: TARGET.content, epistemicStatus: "disputed" });
  });

  it("builds retire_claim, link and set_epistemic_status", () => {
    const values = { ...initialValues(TARGET), reason: "Superseded", toUnitId: "u2", relationshipType: "supports" as const, epistemicStatus: "hypothesis" as const };
    expect(buildPersonAction("retire", TARGET, values).input).toEqual({ reason: "Superseded", validTo: null });
    expect(buildPersonAction("link", TARGET, values)).toMatchObject({ type: "link", targetId: TARGET.id, input: { toUnitId: "u2", type: "supports" } });
    expect(buildPersonAction("set_status", TARGET, values).input).toEqual({ epistemicStatus: "hypothesis" });
  });
});

describe("validateValues", () => {
  it("blocks empty or unchanged forms", () => {
    const values = initialValues(TARGET);
    expect(validateValues("revise", TARGET, values)).toBe("Nothing changed.");
    expect(validateValues("retire", TARGET, values)).toBe("Say why it is retired.");
    expect(validateValues("link", TARGET, values)).toBe("Pick the unit to link to.");
    expect(validateValues("set_status", TARGET, { ...values, epistemicStatus: "established" })).toBe("That is already its status.");
  });

  it("accepts a real change", () => {
    expect(validateValues("set_status", TARGET, { ...initialValues(TARGET), epistemicStatus: "disputed" })).toBeNull();
  });
});
