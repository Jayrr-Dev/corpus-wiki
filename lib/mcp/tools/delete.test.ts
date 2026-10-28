import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@/lib/agents/types";

const mocks = vi.hoisted(() => ({
  deletePage: vi.fn(), removeSection: vi.fn(), removeLine: vi.fn(), removeSource: vi.fn(),
  deleteEntityAction: vi.fn(), deleteDomainAction: vi.fn(), setAssetDeleted: vi.fn(),
  line: null as { current_revision_id: string } | null,
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => {
    const chain = { select: () => chain, eq: () => chain, is: () => chain, maybeSingle: async () => ({ data: mocks.line, error: null }) };
    return { from: () => chain };
  },
}));
vi.mock("@/lib/server-actions/pages", () => ({ deletePage: mocks.deletePage, removeSection: mocks.removeSection, removeLine: mocks.removeLine }));
vi.mock("@/lib/server-actions/sources", () => ({ removeSource: mocks.removeSource }));
vi.mock("@/lib/server-actions/catalog", () => ({ deleteEntityAction: mocks.deleteEntityAction, deleteDomainAction: mocks.deleteDomainAction }));
vi.mock("@/lib/server-actions/assets", () => ({ setAssetDeleted: mocks.setAssetDeleted }));

import { deleteTools } from "./delete";

const session = { key: { keyId: "k", name: "Claude", personId: "p", spaceId: "s", scopes: ["delete"] }, spaceId: "s" } as AgentSession;
const ID = "00000000-0000-4000-8000-000000000001";
const REV = "00000000-0000-4000-8000-000000000002";

async function call(name: string, args: Record<string, unknown>) {
  const tool = deleteTools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`No tool ${name}`);
  return tool.run(tool.input.parse(args) as never, { session });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of [mocks.deletePage, mocks.removeSection, mocks.removeLine, mocks.setAssetDeleted]) mock.mockResolvedValue({ ok: true });
  mocks.line = { current_revision_id: REV };
});

describe("delete tools", () => {
  it("are all scope delete, destructive, say whether they can be undone, and never declare space", () => {
    expect(deleteTools.map((t) => t.name).sort()).toEqual(["delete_article", "delete_asset", "delete_domain", "delete_entity", "remove_line", "remove_section", "remove_source"]);
    for (const t of deleteTools) {
      expect(t.scope).toBe("delete");
      expect(t.annotations.destructiveHint).toBe(true);
      expect(t.annotations.readOnlyHint).toBe(false);
      expect(t.input.shape).not.toHaveProperty("space");
      expect(t.description).toMatch(/cannot be undone|undo_change_set|restore_asset/);
    }
  });

  it("maps each tool to its action", async () => {
    await call("delete_article", { pageId: ID });
    expect(mocks.deletePage).toHaveBeenCalledWith(ID);
    await call("remove_section", { sectionId: ID });
    expect(mocks.removeSection).toHaveBeenCalledWith(ID);
    expect(await call("delete_asset", { assetId: ID })).toMatchObject({ deleted: true, undo: "restore_asset" });
    expect(mocks.setAssetDeleted).toHaveBeenCalledWith(ID, true);

    mocks.removeSource.mockResolvedValue({ ok: true, lostUnits: 3 });
    expect(await call("remove_source", { sourceId: ID })).toEqual({ sourceId: ID, lostUnits: 3, href: "/sources" });
    mocks.deleteEntityAction.mockResolvedValue({ ok: true, deleted: 1 });
    expect(await call("delete_entity", { entityId: ID })).toEqual({ entityId: ID, deleted: 1, href: "/entities" });
    mocks.deleteDomainAction.mockResolvedValue({ ok: true, deleted: 2 });
    expect(await call("delete_domain", { domainId: ID })).toEqual({ domainId: ID, deleted: 2, href: "/domains" });
  });

  it("removes a line at the revision given, else at its current one", async () => {
    const given = "00000000-0000-4000-8000-000000000003";
    await call("remove_line", { lineId: ID, lineRevisionId: given });
    expect(mocks.removeLine).toHaveBeenLastCalledWith(ID, given);
    await call("remove_line", { lineId: ID });
    expect(mocks.removeLine).toHaveBeenLastCalledWith(ID, REV);
    mocks.line = null;
    await expect(call("remove_line", { lineId: ID })).rejects.toThrow("not in this Space");
  });

  it("turns a refused action into a thrown error", async () => {
    mocks.deleteEntityAction.mockResolvedValue({ ok: false, error: "Only a retired entity can be deleted. Retire it first." });
    await expect(call("delete_entity", { entityId: ID })).rejects.toThrow("Retire it first.");
    expect(() => deleteTools[0]!.input.parse({ pageId: "not-an-id" })).toThrow();
  });
});
