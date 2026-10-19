import { beforeEach, expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { expandArticleCoverage } from "./articleCoverage";

const discovery = vi.hoisted(() => vi.fn());
const rebuild = vi.hoisted(() => vi.fn());
const scaffold = vi.hoisted(() => vi.fn());
vi.mock("./discoverArticleUpdates", () => ({ discoverArticleUpdates: discovery }));
vi.mock("./index", () => ({ rebuildUploadSection: rebuild }));
vi.mock("./articleScaffold", () => ({ applyArticleScaffold: scaffold }));
beforeEach(() => {
  vi.clearAllMocks();
  discovery.mockResolvedValue({ sections: [{ title: "New supported topic", query: { unitIds: ["new"], article: true } }], tokensIn: 5, tokensOut: 6 });
  scaffold.mockResolvedValue({ changed: 1, sectionIds: [] });
  rebuild.mockResolvedValue({ rebuildRequested: false });
});
const writer = { name: "test", reviseSection: vi.fn() };
function client(children: object[] = []) {
  const chain = { select: () => chain, eq: () => chain, is: () => chain, limit: async () => ({ data: children, error: null }) };
  return { from: () => chain } as unknown as AdminSupabase;
}
it("adds warranted sections and writes missing coverage before review, without nested reviews", async () => {
  let reads = 0;
  const call = vi.fn(async (name: string) => name === "list_page_sections" ? [{ sectionId: "new-section" }]
    : { units: [{ unitId: "new" }], title: "New supported topic", lines: reads++ ? [{ content: "Full supported explanation.", unitIds: ["new"] }] : [] });
  const db = { call } as DbRpc;
  await expandArticleCoverage(db, { apiKey: "test" }, "page", { client: client(), writer });
  expect(scaffold).toHaveBeenCalledWith(db, expect.anything(), expect.anything(), writer, "page", [expect.objectContaining({ title: "New supported topic" })], "", undefined);
  expect(rebuild).toHaveBeenCalledWith(db, writer, "new-section", null);
});
it("refuses to pass a section with evidence but no written text after its build", async () => {
  const db = { call: vi.fn(async (name: string) => name === "list_page_sections" ? [{ sectionId: "s" }] : { units: [{ unitId: "u" }], title: "Missing", lines: [] }) } as DbRpc;
  await expect(expandArticleCoverage(db, { apiKey: "test" }, "page", { client: client(), writer })).rejects.toThrow("no text");
});
it("keeps a parent overview from absorbing its child articles' details", async () => {
  const db = { call: vi.fn().mockResolvedValue([]) } as DbRpc;
  await expandArticleCoverage(db, { apiKey: "test" }, "page", { client: client([{ id: "child" }]), writer });
  expect(discovery).not.toHaveBeenCalled();
});
it("does not immediately regenerate a freshly checked scaffold section for a valid editorial omission", async () => {
  scaffold.mockResolvedValue({ changed: 1, sectionIds: ["written"] });
  const db = { call: vi.fn(async (name: string) => name === "list_page_sections" ? [{ sectionId: "written" }]
    : { units: [{ unitId: "covered" }, { unitId: "covered-elsewhere" }], title: "Details", lines: [{ content: "Checked supported text.", unitIds: ["covered"], needsRewrite: false }] }) } as DbRpc;
  await expandArticleCoverage(db, { apiKey: "test" }, "page", { client: client(), writer });
  expect(rebuild).not.toHaveBeenCalled();
});
it("still refreshes citations changed after a scaffold section was written", async () => {
  scaffold.mockResolvedValue({ changed: 1, sectionIds: ["written"] });
  let reads = 0;
  const db = { call: vi.fn(async (name: string) => name === "list_page_sections" ? [{ sectionId: "written" }]
    : { units: [{ unitId: "claim" }], title: "Changed evidence", lines: [{ content: "Checked text.", unitIds: ["claim"], needsRewrite: reads++ === 0 }] }) } as DbRpc;
  await expandArticleCoverage(db, { apiKey: "test" }, "page", { client: client(), writer });
  expect(rebuild).toHaveBeenCalledWith(db, writer, "written", null);
});
