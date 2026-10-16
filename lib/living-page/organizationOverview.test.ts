import { describe, expect, it } from "vitest";
import type { CuratorPage } from "@/lib/curator/score";
import { organizationPageHealth, overviewSections, type OverviewInput } from "./organizationOverview";

const page = (id: string, claimIds: string[], extra: Partial<CuratorPage> = {}): CuratorPage =>
  ({ id, title: id, parentId: null, articleType: null, scope: null, contextName: null, organization: false, claimIds, lines: 1, sections: [], ...extra });
const unit = (id: string) => ({ unitId: id, revisionId: `r${id}`, content: id, kind: "fact" as const, epistemicStatus: "supported" as const });
const input: OverviewInput = { organization: { id: "e", type: "company", key: "co", name: "Co" }, own: [unit("o1"), unit("o2")], borrowed: [unit("k1"), unit("k2"), unit("k3"), unit("k4")], childPages: ["Program"] };

describe("organization page health", () => {
  it("asks for an overview only when the page repeats more than an opening's worth of its children", () => {
    const pages = [page("org", ["1", "2", "3", "4", "9"], { organization: true }), page("program", ["1", "2", "3", "4"], { parentId: "org" }), page("small", ["1", "2", "3"], { organization: true }), page("kid", ["1", "2", "3"], { parentId: "small" })];
    expect(organizationPageHealth(pages).map((h) => [h.pageId, h.childClaims, h.needsOverview])).toEqual([["org", 4, true], ["small", 3, false]]);
  });
});

describe("overview sections", () => {
  it("keeps every own claim and lets only the opening borrow from children", () => {
    const sections = overviewSections({ introduction: ["O1", "K1"], sections: [{ title: "Ownership", claims: ["O1", "O2"] }] }, input);
    expect(sections.map((s) => [s.title, s.query.unitIds])).toEqual([["Overview", ["o1", "k1"]], ["Ownership", ["o1", "o2"]]]);
  });
  it("refuses a child claim in a section, a missing own claim, or more than three borrowed", () => {
    expect(() => overviewSections({ introduction: ["O1"], sections: [{ title: "PPE", claims: ["O1", "O2", "K1"] }] }, input)).toThrow(/not one of the organization's own claims/);
    expect(() => overviewSections({ introduction: ["O1"], sections: [{ title: "A", claims: ["O1"] }] }, input)).toThrow(/left out the organization's own claims O2/);
    expect(() => overviewSections({ introduction: ["K1", "K2", "K3", "K4"], sections: [{ title: "A", claims: ["O1", "O2"] }] }, input)).toThrow(/at most 3/);
  });
});

describe("detail claims", () => {
  it("treats measurements and limits as detail, not general statements", async () => {
    const { isDetailClaim } = await import("./organizationOverview");
    expect(isDetailClaim("Power facilities require 1.8m to water lines")).toBe(true);
    expect(isDetailClaim("Gas mains need at least 0.8 m of cover")).toBe(true);
    expect(isDetailClaim("Lines above 25 kV need a permit")).toBe(true);
    expect(isDetailClaim("Utilitek Solutions Inc. was founded in 1998 in Edmonton")).toBe(false);
    expect(isDetailClaim("Utilities agree on clearances between their facilities")).toBe(false);
  });
});
