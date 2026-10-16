import { describe, expect, it } from "vitest";
import { decisionOutcome, roleLabel } from "./describeDecision";

describe("decision history", () => {
  it("uses the decision outcome rather than the applied audit status", () => {
    expect(decisionOutcome({ status: "applied" }, { outcome: "rejected" })).toBe("Rejected");
    expect(decisionOutcome({ status: "applied" }, { outcome: "approved" })).toBe("Approved");
    expect(decisionOutcome({ status: "applied" }, { outcome: "error" })).toBe("Error");
    expect(decisionOutcome({ status: "applied" }, { operation: "Archived" })).toBe("Archived");
    expect(decisionOutcome({ status: "applied" }, { operation: "Restored" })).toBe("Restored");
    expect(decisionOutcome({ status: "reverted" }, { outcome: "approved" })).toBe("Reverted");
    expect(decisionOutcome({ status: "applied" }, null)).toBe("Pending");
  });
  it("labels roles without inventing historical model attribution", () => {
    expect(roleLabel({ role: "reviewer", model: "test-model" })).toBe("Reviewer (test-model)");
    expect(roleLabel({ role: "researcher", model: null })).toBe("Researcher (model not recorded)");
    expect(roleLabel(null)).toBeNull();
  });
});
