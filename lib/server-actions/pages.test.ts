import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), getDeps: vi.fn(), getAdmin: vi.fn(), empty: vi.fn(), discover: vi.fn(), repair: vi.fn(),
  refresh: vi.fn(), overview: vi.fn(), revert: vi.fn(), prune: vi.fn(), restructure: vi.fn(), needsStructure: vi.fn(), submit: vi.fn(), commit: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/living-page/refreshOrganizationOverviews", () => ({ refreshOrganizationOverviews: mocks.overview }));
vi.mock("@/lib/auth/requireUser", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/server/deps", () => ({ getServerDeps: mocks.getDeps }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: mocks.getAdmin }));
vi.mock("@/lib/ai/models", async (original) => ({ ...await original<object>(), readModelChoice: async () => ({}), readAllowExternalKnowledge: async () => false }));
vi.mock("@/lib/ai/chat", async (original) => ({ ...await original<object>(), tokenFactoryFromEnv: () => ({ apiKey: "test" }) }));
vi.mock("@/lib/ai/skills/server", () => ({ loadStageSkills: async () => ({}) }));
vi.mock("@/lib/living-page/emptyArticleCandidates", () => ({ emptyArticleCandidates: mocks.empty }));
vi.mock("@/lib/living-page/discoverArticleUpdates", () => ({ discoverArticleUpdates: mocks.discover, repairEmptyIntroductions: mocks.repair }));
vi.mock("@/lib/living-page/refreshStyle", () => ({ refreshSectionStyle: mocks.refresh }));
vi.mock("@/lib/living-page/pruneEmptySections", () => ({ pruneEmptySections: mocks.prune }));
vi.mock("@/lib/living-page/restructureUpdate", () => ({ restructureUpdate: mocks.restructure, updateNeedsStructure: mocks.needsStructure }));
vi.mock("@/lib/change-control", () => ({ submitChangeSet: mocks.submit, commitChangeSet: mocks.commit, revertChangeSet: mocks.revert, commitPersonEdit: vi.fn() }));
vi.mock("next/server", () => ({ after: mocks.after }));

import { updateArticle } from "./pages";
const id = "10000000-0000-4000-8000-000000000001";
const page = { id, title: "Utility clearance standards", scope: "Clearance standards", entity_id: null, context_entity_id: null, parent_page_id: null };
const section = { sectionId: "section", pageId: id };
let sections: typeof section[];
const db = { call: vi.fn(async () => sections) };
beforeEach(() => {
  vi.clearAllMocks();
  sections = [];
  const chain = { select: () => chain, is: async () => ({ data: [page], error: null }) };
  mocks.getAdmin.mockReturnValue({ from: () => chain });
  mocks.getDeps.mockResolvedValue({ db, writer: { name: "test" } });
  mocks.empty.mockResolvedValue(["claim"]);
  mocks.repair.mockResolvedValue([]);
  mocks.discover.mockResolvedValue({ sections: [{ title: "Overview", query: { unitIds: ["claim"], article: true } }], tokensIn: 1, tokensOut: 1 });
  mocks.needsStructure.mockResolvedValue(false);
  mocks.overview.mockResolvedValue([]);
  mocks.submit.mockResolvedValue({ changeSetId: "change" });
  mocks.commit.mockImplementation(async () => { sections = [section]; return { status: "applied" }; });
});

it("replans a parent as an overview without rediscovering or web-filling its child's procedure", async () => {
  const parent = { ...page, title: "City of Edmonton" };
  const child = { ...page, id: "child", title: "ULA application process", parent_page_id: id };
  const chain = { select: () => chain, is: async () => ({ data: [parent, child], error: null }) };
  mocks.getAdmin.mockReturnValue({ from: () => chain });
  sections = [section];
  mocks.overview.mockResolvedValue([{ pageId: id, status: "applied" }]);
  expect(await updateArticle({ scope: "page", id, note: "" })).toEqual({ ok: true, sections: 1 });
  expect(mocks.overview).toHaveBeenCalledWith(expect.objectContaining({ db }), null, { pageIds: [id] });
  expect(mocks.discover).not.toHaveBeenCalled();
  expect(mocks.repair).not.toHaveBeenCalled();
  expect(mocks.refresh).toHaveBeenCalledWith(db, expect.anything(), "section", "");
});

it("does not fall back to the old child-topic sections when overview planning fails", async () => {
  const chain = { select: () => chain, is: async () => ({ data: [page, { ...page, id: "child", parent_page_id: id }], error: null }) };
  mocks.getAdmin.mockReturnValue({ from: () => chain });
  mocks.overview.mockResolvedValue([{ pageId: id, status: "failed", detail: "Overview planning failed" }]);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await updateArticle({ scope: "page", id, note: "" })).toEqual({ ok: false, error: "Overview planning failed" });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.discover).not.toHaveBeenCalled();
  } finally { log.mockRestore(); }
});

it("restores the old outline when writing its replacement fails after partial progress", async () => {
  const chain = { select: () => chain, is: async () => ({ data: [page, { ...page, id: "child", parent_page_id: id }], error: null }) };
  mocks.getAdmin.mockReturnValue({ from: () => chain });
  sections = [section, { ...section, sectionId: "second" }];
  mocks.overview.mockResolvedValue([{ pageId: id, status: "applied", changeSetId: "replacement" }]);
  mocks.refresh.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Editorial rewrite failed"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await updateArticle({ scope: "page", id, note: "" })).toEqual({ ok: false, error: "Editorial rewrite failed" });
    expect(mocks.revert).toHaveBeenCalledWith(db, "replacement");
    expect(mocks.discover).not.toHaveBeenCalled();
  } finally { log.mockRestore(); }
});

it("builds an empty page through discovery, audited sections and the normal writer", async () => {
  expect(await updateArticle({ scope: "page", id, note: "" })).toEqual({ ok: true, sections: 1 });
  expect(mocks.requireUser).toHaveBeenCalledOnce();
  expect(mocks.empty).toHaveBeenCalledOnce();
  expect(mocks.discover).toHaveBeenCalledWith(db, expect.anything(), expect.anything(), id, "", ["claim"]);
  expect(mocks.submit.mock.calls[0]?.[2].actions).toEqual([expect.objectContaining({ type: "create_section", input: { pageId: id, title: "Overview", query: { unitIds: ["claim"], article: true } } })]);
  expect(mocks.refresh).toHaveBeenCalledWith(db, expect.anything(), "section", "");
});

it("returns a helpful non-error result when discovery finds no supported content", async () => {
  mocks.empty.mockResolvedValue([]);
  mocks.discover.mockResolvedValue({ sections: [], tokensIn: 0, tokensOut: 0 });
  expect(await updateArticle({ scope: "page", id, note: "" })).toEqual({ ok: true, sections: 0, message: expect.stringContaining("No saved knowledge fits") });
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("uses the note to build an empty article instead of trying to reorganize missing sections", async () => {
  mocks.needsStructure.mockResolvedValue(true);
  expect(await updateArticle({ scope: "page", id, note: "Split by topic" })).toEqual({ ok: true, sections: 1 });
  expect(mocks.restructure).not.toHaveBeenCalled();
  expect(mocks.discover.mock.calls[0]?.[4]).toBe("Split by topic");
});

it("keeps the existing section update path without broadening its selection", async () => {
  sections = [section];
  mocks.discover.mockResolvedValue({ sections: [], tokensIn: 0, tokensOut: 0 });
  expect(await updateArticle({ scope: "page", id, note: "" })).toEqual({ ok: true, sections: 1 });
  expect(mocks.empty).not.toHaveBeenCalled();
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it("still reports a genuine discovery failure instead of treating it as no matching knowledge", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    mocks.discover.mockRejectedValueOnce(new Error("Provider unavailable"));
    expect(await updateArticle({ scope: "page", id, note: "" })).toEqual({ ok: false, error: "Provider unavailable" });
    expect(mocks.submit).not.toHaveBeenCalled();
  } finally { log.mockRestore(); }
});
