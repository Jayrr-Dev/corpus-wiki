import { beforeEach, expect, it, vi } from "vitest";
import { deleteSpace, renameSpace } from "./spaces";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), call: vi.fn(), select: vi.fn(), actor: vi.fn() }));
vi.mock("@/lib/auth/requireUser", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => ({}) }));
vi.mock("@/lib/db/rpc", () => ({ supabaseRpc: () => ({ call: mocks.call }) }));
vi.mock("@/lib/spaces/server", () => ({ selectOwnedSpace: mocks.select }));
vi.mock("@/lib/auth/currentPerson", () => ({ currentActor: mocks.actor }));
beforeEach(() => { vi.clearAllMocks(); mocks.actor.mockResolvedValue({ spaceId: id }); });
const id = "10000000-0000-4000-8000-000000000001";
const replacement = "10000000-0000-4000-8000-000000000002";

it("passes the exact confirmation unchanged and selects the database's fallback after deletion", async () => {
  mocks.call.mockResolvedValue(replacement);
  expect(await deleteSpace(id, "  Exact name  ")).toEqual({ ok: true });
  expect(mocks.requireUser).toHaveBeenCalledOnce();
  expect(mocks.call).toHaveBeenCalledWith("delete_space", { p_id: id, p_name: "  Exact name  " });
  expect(mocks.select).toHaveBeenCalledWith(replacement);
});

it("does not change the active space when the database rejects deletion", async () => {
  const warning = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.call.mockRejectedValue(new Error("Type the space name exactly to confirm deletion"));
  try {
    expect(await deleteSpace(id, "wrong")).toEqual({ ok: false, error: "Type the space name exactly to confirm deletion" });
    expect(mocks.select).not.toHaveBeenCalled();
  } finally { warning.mockRestore(); }
});

it("renames the selected space without modifying its data or selection", async () => {
  const space = { id, name: "Research" };
  mocks.call.mockResolvedValue(space);
  expect(await renameSpace(id, " Research ")).toEqual({ ok: true, space });
  expect(mocks.call).toHaveBeenCalledWith("rename_space", { p_id: id, p_name: "Research" });
  expect(mocks.select).not.toHaveBeenCalled();
});

it("preserves the current selection when deleting a different space from its row menu", async () => {
  mocks.actor.mockResolvedValue({ spaceId: replacement });
  mocks.call.mockResolvedValue(replacement);
  expect(await deleteSpace(id, "Other space")).toEqual({ ok: true });
  expect(mocks.select).not.toHaveBeenCalled();
});
