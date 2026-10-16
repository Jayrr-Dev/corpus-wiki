import { describe, expect, it } from "vitest";
import { contextRelevance } from "./contextSelection";
import type { KnowledgeContext } from "./context";

const company = { type: "company", key: "utilitek" };
const context = (status: KnowledgeContext["applicability"]["status"]): KnowledgeContext => ({ entities: [{ ...company, role: "subject" }], applicability: { status, entities: status === "scoped" ? [company] : [], conditions: null } });
describe("context selection", () => {
  it("does not return another company's policy even if it mentions the selected company", () => {
    const claim = context("scoped");
    claim.entities[0]!.role = "mentioned";
    claim.applicability.entities = [{ type: "company", key: "other" }];
    expect(contextRelevance(claim, company)).toBe("excluded");
  });
  it("retains a person's company-scoped role as qualified knowledge about that person", () => {
    const person = { type: "person", key: "alex" };
    const claim = context("scoped");
    claim.entities = [{ ...person, role: "subject" }];
    expect(contextRelevance(claim, person)).toBe("contextual");
    expect(contextRelevance(claim, company)).toBe("applicable");
  });
  it("retains condition-only claims about an entity without asserting applicability", () => {
    const claim = context("scoped");
    claim.applicability = { status: "scoped", entities: [], conditions: "Only during the pilot" };
    expect(contextRelevance(claim, company)).toBe("contextual");
  });
  it("labels general guidance and unresolved knowledge distinctly", () => {
    expect(contextRelevance(context("general"), company)).toBe("general");
    expect(contextRelevance(context("unspecified"), company)).toBe("unspecified");
  });
  it("does not treat a passing mention as knowledge about that entity", () => {
    const claim = context("unspecified");
    claim.entities[0]!.role = "mentioned";
    expect(contextRelevance(claim, company)).toBe("excluded");
  });
});
