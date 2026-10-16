import { describe, expect, it } from "vitest";
import { type ArticleProposalsAnswer, buildProposerMessages, type ProposerInput, readProposals } from "./articleProposer";

const PAGE = "11111111-1111-4111-8111-111111111111";
const claim = (n: number) => ({ unitId: `u${n}`, revisionId: `r${n}`, content: `Claim ${n}`, kind: "fact" as const, epistemicStatus: "stated" as never, topics: ["City of Edmonton/ULA"], entityIds: n === 1 ? ["e1"] : [] });
const input: ProposerInput = {
  charter: { purpose: "ULA applications", audience: "", outOfScope: "" },
  articles: [{ id: PAGE, title: "Utility Line Assignment", type: "process", scope: null, parentId: null, claimCount: 9 }],
  entities: [{ id: "e1", type: "organization", key: "epcor", name: "EPCOR" }],
  claims: [1, 2, 3, 4].map(claim),
};
const proposal = (overrides: Partial<ArticleProposalsAnswer["proposals"][number]>): ArticleProposalsAnswer["proposals"][number] =>
  ({ action: "create", pageId: null, title: "Minimum clearances", type: "requirement", scope: "Clearance limits.", parentPageId: null, entity: null, claims: ["C1"], ...overrides });

describe("readProposals", () => {
  it("resolves refs to claims, entities and pages", () => {
    const planned = readProposals({ proposals: [
      proposal({ action: "update", pageId: PAGE, title: "", type: null, scope: "", claims: ["C1", "C2"] }),
      proposal({ title: "EPCOR", type: "entity", entity: "E1", claims: ["C3", "c4"] }),
    ] }, input);
    expect(planned[0]).toMatchObject({ action: "update", pageId: PAGE });
    expect(planned[0]!.claims.map((item) => item.unitId)).toEqual(["u1", "u2"]);
    expect(planned[1]).toMatchObject({ action: "create", entity: { id: "e1" } });
  });
  it("refuses a claim in two proposals", () => {
    expect(() => readProposals({ proposals: [proposal({ claims: ["C1"] }), proposal({ title: "Other", claims: ["C1"] })] }, input)).toThrow(/more than one/);
  });
  it("refuses an update to a page outside the index", () => {
    expect(() => readProposals({ proposals: [proposal({ action: "update", pageId: "nope" })] }, input)).toThrow(/article index/);
  });
  it("refuses an entity article without its entity", () => {
    expect(() => readProposals({ proposals: [proposal({ type: "entity" })] }, input)).toThrow(/E ref/);
  });
  it("refuses unknown claim refs", () => {
    expect(() => readProposals({ proposals: [proposal({ claims: ["C9"] })] }, input)).toThrow(/unknown claim/);
  });
});

describe("buildProposerMessages", () => {
  it("names entities by ref, never by id", () => {
    const data = JSON.parse(buildProposerMessages("RULES", input)[1]!.content);
    expect(data.claims[0]).toEqual({ ref: "C1", content: "Claim 1", topics: ["City of Edmonton/ULA"], about: ["E1"] });
    expect(JSON.stringify(data.entities)).not.toContain("e1");
  });
});
