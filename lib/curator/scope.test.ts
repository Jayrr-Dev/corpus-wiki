import { afterEach, expect, it, vi } from "vitest";
import { curate, type CuratorSnapshot } from "./curate";
import { affectedPageIds } from "./scope";
import type { CuratorPage } from "./score";

afterEach(() => vi.unstubAllGlobals());
const page = (id: string, claim: string, parentId: string | null = null): CuratorPage => ({
  id, title: `Article ${id}`, parentId, articleType: "concept", scope: "A distinct subject", contextName: null,
  organization: false, claimIds: [claim], lines: 1, sections: ["Overview"],
});
const snapshot: CuratorSnapshot = {
  pages: [page("parent", "parent-claim"), page("changed", "new", "parent"), page("related", "new", "parent"), page("unrelated", "old")],
  claims: [{ id: "new", title: "New fact" }, { id: "old", title: "Old fact" }],
  vectors: [{ id: "new", vector: [1, 0] }, { id: "old", vector: [0, 1] }],
};
const rename = (ref: string) => ({ operation: "rename", page: ref, pages: null, into: null, parent: null, title: `Renamed ${ref}`, sectionTitle: null, articleType: null, scope: null, confident: true, reason: "Clearer title" });
const review = (ref: string) => ({ role: "reviewer", page: ref, heading: null, note: "Review wording", reason: "Clarity" });
const mockAnswer = (value: unknown) => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ model: "test", usage: { prompt_tokens: 10, completion_tokens: 10 },
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] })));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};

it("includes affected ancestors and related duplicates, while preventing unrelated automatic upkeep", async () => {
  const fetcher = mockAnswer({ proposals: [rename("P2"), rename("P4")], dispatches: [review("P3"), review("P4")], summary: "Review flagged pages" });
  const result = await curate({ apiKey: "test" }, snapshot, { scope: { pageIds: ["changed"], unitIds: ["new"] } });
  expect(result.candidates.some((candidate) => candidate.pageIds.includes("related"))).toBe(true);
  expect(result.candidates.every((candidate) => !candidate.pageIds.includes("unrelated"))).toBe(true);
  expect(result.changes.map((change) => change.pageId)).toEqual(["changed"]);
  expect(result.dispatches.map((dispatch) => dispatch.pageId)).toEqual(["related"]);
  const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
  const evidence = JSON.parse(request.messages.find((message: { role: string }) => message.role === "user").content);
  expect(evidence.pages).toHaveLength(4);
  expect(affectedPageIds(snapshot.pages, { pageIds: [], unitIds: ["new"] })).toEqual(new Set(["changed", "related", "parent"]));
});

it("skips AI for an upload with no affected pages or claims, while a manual pass still sees the whole tree", async () => {
  const fetcher = mockAnswer({ proposals: [rename("P4")], dispatches: [], summary: "Manual upkeep" });
  expect((await curate({ apiKey: "test" }, snapshot, { scope: { pageIds: [], unitIds: [] } })).candidates).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled();
  expect((await curate({ apiKey: "test" }, snapshot)).changes.map((change) => change.pageId)).toEqual(["unrelated"]);
});

it("offers the proposer only this upload's uncovered claims", async () => {
  mockAnswer({ proposals: [], dispatches: [{ role: "proposer", page: null, heading: null, note: "Find an article", reason: "Uncovered claims" }], summary: "Cover new facts" });
  const input = { ...snapshot, unplaced: [{ id: "uncovered-new", title: "New uncovered" }, { id: "uncovered-old", title: "Old uncovered" }],
    vectors: [...snapshot.vectors.map((row) => ({ ...row, vector: [...row.vector as number[], 0] })),
      { id: "uncovered-new", vector: [0, 0, 1] }, { id: "uncovered-old", vector: [0, 0, 1] }] };
  const result = await curate({ apiKey: "test" }, input, { scope: { pageIds: [], unitIds: ["uncovered-new"] } });
  expect(result.dispatches).toMatchObject([{ role: "proposer", claimIds: ["uncovered-new"] }]);
});
