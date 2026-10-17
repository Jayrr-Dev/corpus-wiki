import { describe, expect, it, vi } from "vitest";
import { articleDuplicateCandidates } from "./articleDuplicates";
import type { ArticleIndexEntry, ArticleReviewInput } from "./articleReview";
import { nextStep } from "./articleReview";
import { reviewArticleProposal } from "./runArticleReview";

const article = (id: string, title: string, scope = "The Edmonton application process."): ArticleIndexEntry => ({
  id, title, scope, type: "process", parentId: null, claimCount: 10,
});
const input = (title: string, articles: ArticleIndexEntry[]): ArticleReviewInput => ({
  charter: { purpose: "Project knowledge", audience: "", outOfScope: "" }, articles, related: [],
  proposal: { title, type: "process", scope: "The Edmonton application process.", parentPageId: null,
    claims: [1, 2, 3].map((i) => ({ ref: `C${i}`, content: `Supported claim ${i}` })) },
});

describe("page title duplicate candidates", () => {
  it.each([
    ["Consumer products", "Consumer product"],
    ["Quality managment", "Quality management"],
    ["ULA", "Utility Line Assignment (ULA)"],
    ["Utility Line Assignment", "Utility Line Assignment (ULA)"],
    ["WHMIS", "Workplace Hazardous Materials Information System"],
  ])("shortlists %s against %s", (proposed, existing) => {
    expect(articleDuplicateCandidates(input(proposed, [article("match", existing), article("other", "EPCOR")]))
      .map((candidate) => candidate.article.id)).toContain("match");
  });

  it("retains scope and parent details for identical titles instead of choosing an automatic target", () => {
    const data = input("Utility clearance standards", [
      { ...article("edmonton", "Utility clearance standards", "Edmonton"), parentId: "city" },
      { ...article("acme", "Utility clearance standards", "Acme"), parentId: "company" },
    ]);
    const candidates = articleDuplicateCandidates(data);
    expect(candidates.map((candidate) => candidate.article.scope)).toEqual(["Edmonton", "Acme"]);
    expect(candidates.map((candidate) => candidate.article.parentId)).toEqual(["city", "company"]);
  });

  it("includes semantically related pages even without similar titles and ignores stale page ids", () => {
    const data = input("Protective clothing", [article("existing", "PPE")]);
    data.related = [{ ref: "R1", content: "Protective clothing reduces exposure.", pageIds: ["existing", "retired"] }];
    expect(articleDuplicateCandidates(data)).toEqual([{ article: data.articles[0], signals: ["related knowledge"] }]);
  });

  it("does not shortlist unrelated page titles", () => {
    expect(articleDuplicateCandidates(input("Quality inspection", [article("a", "EPCOR"), article("b", "ATCO Pipelines")]))).toEqual([]);
  });

  it("passes fuzzy candidates to the independent AI and routes a confirmed duplicate to an update", async () => {
    const data = input("Consumer products", [article("existing", "Consumer product")]);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      checks: { distinct: false, standalone: true, substantive: true, inScope: true, typeFits: true },
      verdict: "update_existing", targetPageId: "existing", sectionTitle: null, reason: "Same subject and scope.",
    }) }, finish_reason: "stop" }] })));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const decision = await reviewArticleProposal({ apiKey: "test", model: "test-model" }, data);
      expect(nextStep(decision, data.proposal)).toMatchObject({ kind: "update_article", pageId: "existing" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const request = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [URL, RequestInit])[1].body));
      expect(request.messages.some((message: { content: string }) => message.content.includes("Before approving a new page"))).toBe(true);
      const payload = JSON.parse(request.messages.at(-1).content);
      expect(payload.duplicateCandidates[0].article.id).toBe("existing");
      expect(payload.articles).toEqual(data.articles);
    } finally { vi.unstubAllGlobals(); }
  });
});
