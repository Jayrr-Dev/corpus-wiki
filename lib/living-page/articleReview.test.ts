import { describe, expect, it } from "vitest";
import { readCharter } from "./articleCharter";
import { type ArticleReviewAnswer, type ArticleReviewInput, buildArticleReviewMessages, nextStep, readArticleReview, ruleDecision, validateArticleReview } from "./articleReview";

const ULA = "11111111-1111-4111-8111-111111111111";
const claims = (count: number) => Array.from({ length: count }, (_, index) => ({ ref: `C${index + 1}`, content: `Claim ${index + 1}` }));
const input = (overrides: Partial<ArticleReviewInput["proposal"]> = {}): ArticleReviewInput => ({
  charter: { purpose: "ULA applications in Edmonton", audience: "", outOfScope: "" },
  articles: [{ id: ULA, title: "Utility Line Assignment", type: "process", scope: "How ULA applications work.", parentId: null, claimCount: 20 }],
  proposal: { title: "Drafting technologist role in the ULA process", type: "process", scope: "What the drafter does.", parentPageId: null, claims: claims(4), ...overrides },
  related: [],
});
const pass = { distinct: true, standalone: true, substantive: true, inScope: true, typeFits: true };
const answer = (overrides: Partial<ArticleReviewAnswer>): ArticleReviewAnswer => ({ checks: pass, verdict: "approve", targetPageId: null, sectionTitle: null, reason: "Fine.", ...overrides });

describe("ruleDecision", () => {
  it("rejects a proposal with too few claims without asking the model", () => {
    expect(ruleDecision(input({ claims: claims(2) }))).toMatchObject({ verdict: "reject", failed: ["substantive"], decidedBy: "rule" });
  });
  it("sends a proposal whose title already exists to that article", () => {
    expect(ruleDecision(input({ title: "utility line assignment" }))).toMatchObject({ verdict: "update_existing", targetPageId: ULA });
  });
  it("leaves everything else to the model", () => {
    expect(ruleDecision(input())).toBeNull();
  });
});

describe("validateArticleReview", () => {
  it("accepts a section of an article in the index", () => {
    const value = answer({ checks: { ...pass, standalone: false }, verdict: "section_of", targetPageId: ULA, sectionTitle: "Drafting technologist" });
    expect(() => validateArticleReview(value, input())).not.toThrow();
    expect(readArticleReview(value)).toMatchObject({ failed: ["standalone"], sectionTitle: "Drafting technologist" });
  });
  it("refuses an approval with a failed check", () => {
    expect(() => validateArticleReview(answer({ checks: { ...pass, distinct: false } }), input())).toThrow(/every check/);
  });
  it("refuses a rejection when every check passed", () => {
    expect(() => validateArticleReview(answer({ verdict: "reject" }), input())).toThrow(/must be approve/);
  });
  it("refuses a target outside the index", () => {
    expect(() => validateArticleReview(answer({ checks: { ...pass, distinct: false }, verdict: "update_existing", targetPageId: "22222222-2222-4222-8222-222222222222" }), input())).toThrow(/article index/);
  });
  it("refuses a section without a heading", () => {
    expect(() => validateArticleReview(answer({ checks: { ...pass, standalone: false }, verdict: "section_of", targetPageId: ULA }), input())).toThrow(/sectionTitle/);
  });
});

describe("nextStep", () => {
  it("routes each verdict to one action", () => {
    const proposal = input().proposal;
    const decision = { failed: [], reason: "", decidedBy: "model" as const, sectionTitle: null, targetPageId: null };
    expect(nextStep({ ...decision, verdict: "approve" }, proposal).kind).toBe("create_article");
    expect(nextStep({ ...decision, verdict: "update_existing", targetPageId: ULA }, proposal)).toEqual({ kind: "update_article", pageId: ULA, claimRefs: ["C1", "C2", "C3", "C4"] });
    expect(nextStep({ ...decision, verdict: "section_of", targetPageId: ULA, sectionTitle: "Roles" }, proposal)).toMatchObject({ kind: "add_section", title: "Roles" });
    expect(nextStep({ ...decision, verdict: "reject" }, proposal).kind).toBe("none");
  });
});

describe("independence", () => {
  it("sends only the instructions and the data, with no justification field", () => {
    const messages = buildArticleReviewMessages("RULES", input());
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: "system", content: "RULES" });
    expect(Object.keys(JSON.parse(messages[1]!.content).proposal)).not.toContain("justification");
  });
});

describe("readCharter", () => {
  it("keeps the three text fields, trimmed", () => {
    expect(readCharter({ purpose: " ULA ", audience: 3, extra: "x" })).toEqual({ purpose: "ULA", audience: "", outOfScope: "" });
  });
});
