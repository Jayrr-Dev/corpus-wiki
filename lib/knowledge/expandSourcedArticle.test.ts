import { commitPersonEdit } from "@/lib/change-control";
import { rebuildSection } from "@/lib/living-page";
import { discoverArticleUpdates } from "@/lib/living-page/discoverArticleUpdates";
import { beforeEach, expect, it, vi } from "vitest";
import { expandSourcedArticle } from "./expandSourcedArticle";
vi.mock("@/lib/living-page/discoverArticleUpdates", () => ({ discoverArticleUpdates: vi.fn() }));
vi.mock("@/lib/change-control", () => ({ commitPersonEdit: vi.fn() }));
vi.mock("@/lib/living-page", () => ({ rebuildSection: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
it("writes and reviews only the sections the sourced claims created or added to", async () => {
  vi.mocked(discoverArticleUpdates).mockResolvedValue({ sections: [{ title: "Regulatory responsibilities", query: { unitIds: ["new-claim"], article: true } }], tokensIn: 1, tokensOut: 1 });
  vi.mocked(commitPersonEdit).mockResolvedValue({ status: "applied", changeSetId: "change", applied: 1, rejected: 0, deferred: 0 } as never);
  vi.mocked(rebuildSection).mockResolvedValue({} as never);
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [{ target_id: "new-section" }], error: null }).then(resolve) };
  const deps = { db: { call: vi.fn() }, client: { from: vi.fn().mockReturnValue(query) }, settings: { apiKey: "test" }, writer: { reviewSections: vi.fn() } } as unknown as Parameters<typeof expandSourcedArticle>[0];
  expect(await expandSourcedArticle(deps, "page", ["new-claim"], "", "Definitions")).toBe(1);
  expect(discoverArticleUpdates).toHaveBeenCalledWith(deps.db, deps.client, deps.settings, "page", expect.stringContaining("Definitions"), ["new-claim"]);
  expect(rebuildSection).toHaveBeenCalledTimes(1);
  expect(rebuildSection).toHaveBeenCalledWith(deps.db, deps.writer, "new-section", null, false);
  expect(deps.writer.reviewSections).toHaveBeenCalledWith(["new-section"]);
  expect(query.in).toHaveBeenCalledWith("type", ["create_section", "update_section_query"]);
});
it("does not change the article when no new claims were imported", async () => {
  expect(await expandSourcedArticle({} as never, "page", [], "")).toBe(0);
  expect(discoverArticleUpdates).not.toHaveBeenCalled();
  expect(commitPersonEdit).not.toHaveBeenCalled();
});
vi.mock("@/lib/living-page/articleScaffold", () => ({ articleAdditionActions: vi.fn(async (_db, _client, _settings, pageId, sections) => sections.map((section: object) => ({ type: "create_section", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null, input: { pageId, ...section } }))) }));
