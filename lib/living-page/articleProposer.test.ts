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
  it("keeps a claim given twice in the first proposal and drops a proposal left empty", () => {
    const planned = readProposals({ proposals: [
      proposal({ claims: ["C1", "C2"] }), proposal({ title: "Other", claims: ["C2", "C3"] }), proposal({ title: "Empty", claims: ["C1"] }),
    ] }, input);
    expect(planned.map((item) => item.claims.map((claim) => claim.unitId))).toEqual([["u1", "u2"], ["u3"]]);
  });
  it("refuses an update to a page outside the index", () => {
    expect(() => readProposals({ proposals: [proposal({ action: "update", pageId: "nope" })] }, input)).toThrow(/article index/);
  });
  it("refuses an entity article without its entity", () => {
    expect(() => readProposals({ proposals: [proposal({ type: "entity" })] }, input)).toThrow(/E ref/);
  });
  it("lets a new article sit under another one proposed with it, parent first", () => {
    const planned = readProposals({ proposals: [
      proposal({ title: "Clearance checks", type: "process", parentPageId: "minimum clearances ", claims: ["C2"] }),
      proposal({ title: "Minimum clearances", claims: ["C1"] }),
    ] }, input);
    expect(planned.map((item) => item.action === "create" && item.title)).toEqual(["Minimum clearances", "Clearance checks"]);
    expect(planned[1]).toMatchObject({ parentPageId: null, parentTitle: "minimum clearances" });
  });
  it("refuses a parent that is neither indexed nor proposed, and a loop of parents", () => {
    expect(() => readProposals({ proposals: [proposal({ parentPageId: "Nowhere" })] }, input)).toThrow(/parentPageId/);
    expect(() => readProposals({ proposals: [
      proposal({ title: "A", parentPageId: "B", claims: ["C1"] }), proposal({ title: "B", parentPageId: "A", claims: ["C2"] }),
    ] }, input)).toThrow(/loop/);
  });
  it("refuses unknown claim refs", () => {
    expect(() => readProposals({ proposals: [proposal({ claims: ["C9"] })] }, input)).toThrow(/unknown claim/);
  });
  describe("after the corrective retry (dropInvalid)", () => {
    const read = (proposals: ArticleProposalsAnswer["proposals"]) => readProposals({ proposals }, input, true);
    it("leaves out unknown claims and keeps the rest", () => {
      expect(read([proposal({ claims: ["C42", "C1"] })]).map((item) => item.claims.map((claim) => claim.unitId))).toEqual([["u1"]]);
      expect(read([proposal({ claims: ["C42"] })])).toEqual([]);
    });
    it("leaves out a bad proposal without losing its claims to a later one", () => {
      const planned = read([proposal({ action: "update", pageId: "nope", claims: ["C1"] }), proposal({ title: "", claims: ["C2"] }), proposal({ type: "entity", entity: "E9", claims: ["C3"] }), proposal({ title: "Kept", claims: ["C1", "C2", "C3"] })]);
      expect(planned).toHaveLength(1);
      expect(planned[0]!.claims.map((claim) => claim.unitId)).toEqual(["u1", "u2", "u3"]);
    });
    it("keeps the first of two proposals with one title", () => {
      expect(read([proposal({ claims: ["C1"] }), proposal({ claims: ["C2"] })]).map((item) => item.claims.length)).toEqual([1]);
    });
    it("puts an article with a bad parent, its own title or a parent loop at the top level", () => {
      expect(read([proposal({ parentPageId: "Nowhere" })])[0]).toMatchObject({ parentPageId: null });
      expect(read([proposal({ parentPageId: "Minimum clearances" })])[0]).not.toHaveProperty("parentTitle");
      const loop = read([proposal({ title: "A", parentPageId: "B", claims: ["C1"] }), proposal({ title: "B", parentPageId: "A", claims: ["C2"] })]);
      expect(loop).toHaveLength(2);
      expect(loop.filter((item) => item.action === "create" && item.parentTitle)).toHaveLength(1);
    });
    it("keeps an article whose entity ref is unknown unless it profiles that entity", () => {
      expect(read([proposal({ entity: "E9" })])[0]).toMatchObject({ entity: null });
    });
  });
});

describe("buildProposerMessages", () => {
  it("names entities by ref, never by id", () => {
    const data = JSON.parse(buildProposerMessages("RULES", input)[1]!.content);
    expect(data.claims[0]).toEqual({ ref: "C1", content: "Claim 1", topics: ["City of Edmonton/ULA"], about: ["E1"] });
    expect(JSON.stringify(data.entities)).not.toContain("e1");
  });
});
