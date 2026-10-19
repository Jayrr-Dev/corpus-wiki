import { beforeEach, expect, it, vi } from "vitest";
import { readSpaceWelcome } from "./spaceWelcome";

const mocks = vi.hoisted(() => ({ read: vi.fn(), generate: vi.fn(), settings: vi.fn(), update: vi.fn(), eq: vi.fn(), is: vi.fn(), single: vi.fn() }));
vi.mock("@/lib/spaces/server", () => ({ readMySpaces: mocks.read }));
vi.mock("@/lib/auth/currentPerson", () => ({ withSettledActor: (run: () => unknown) => run() }));
vi.mock("@/lib/ai/chat", () => ({ tokenFactoryFromEnv: mocks.settings, chatJson: vi.fn() }));
vi.mock("@/lib/ai/models", () => ({ readModelChoice: async () => ({ model: null, roleModels: {} }) }));
vi.mock("@/lib/db/rpc", () => ({ supabaseRpc: () => ({ call: vi.fn() }) }));
vi.mock("@/lib/spaces/subtitle", async (original) => ({ ...await original<object>(), generateSpaceSubtitle: mocks.generate }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => ({ from: () => ({ update: mocks.update }) }) }));

const space = { id: "space-a", name: "Gardening", owner_id: "owner-a", subtitle: null, subtitle_for_name: null };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ activeSpace: { ...space }, account: { id: "owner-a" } });
  mocks.settings.mockReturnValue({ apiKey: "test" });
  mocks.generate.mockResolvedValue("Ideas for growing a greener corner of your world.");
  const filter = { eq: mocks.eq, is: mocks.is, select: () => ({ maybeSingle: mocks.single }) };
  mocks.update.mockReturnValue(filter);
  mocks.eq.mockReturnValue(filter);
  mocks.is.mockReturnValue(filter);
  mocks.single.mockResolvedValue({ data: { id: space.id }, error: null });
});

it("reuses a saved subtitle only for the exact current title", async () => {
  mocks.read.mockResolvedValue({ activeSpace: { ...space, subtitle: "Saved copy", subtitle_for_name: "Gardening" }, account: { id: "owner-a" } });
  expect(await readSpaceWelcome()).toEqual({ ok: true, spaceId: space.id, title: space.name, subtitle: "Saved copy" });
  expect(mocks.generate).not.toHaveBeenCalled();
});

it("replaces an old title's subtitle and fences the save by owner, space, name, and deletion", async () => {
  mocks.read.mockResolvedValue({ activeSpace: { ...space, subtitle: "Old copy", subtitle_for_name: "History" }, account: { id: "owner-a" } });
  const result = await readSpaceWelcome();
  expect(result).toMatchObject({ ok: true, title: "Gardening", subtitle: "Ideas for growing a greener corner of your world." });
  expect(mocks.generate).toHaveBeenCalledWith("Gardening", { apiKey: "test" });
  expect(mocks.eq.mock.calls).toEqual([["id", "space-a"], ["owner_id", "owner-a"], ["name", "Gardening"]]);
  expect(mocks.is).toHaveBeenCalledWith("deleted_at", null);
});

it("discards generation when the space was renamed or deleted during the call", async () => {
  mocks.single.mockResolvedValue({ data: null, error: null });
  expect(await readSpaceWelcome()).toMatchObject({ ok: true, subtitle: null });
});

it("keeps the fallback unsaved when no AI provider is configured", async () => {
  mocks.settings.mockReturnValue(null);
  expect(await readSpaceWelcome()).toMatchObject({ ok: true, subtitle: null });
  expect(mocks.update).not.toHaveBeenCalled();
});

it("shares concurrent generation for one space and retries after a failure", async () => {
  const warning = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    mocks.generate.mockRejectedValueOnce(new Error("Provider unavailable"));
    const results = await Promise.all([readSpaceWelcome(), readSpaceWelcome()]);
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(await readSpaceWelcome()).toMatchObject({ ok: true });
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  } finally { warning.mockRestore(); }
});

it("does not call AI or write anything without a signed-in owner", async () => {
  const warning = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.read.mockRejectedValue(new Error("Not signed in"));
  try {
    expect(await readSpaceWelcome()).toEqual({ ok: false, error: "Not signed in" });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  } finally { warning.mockRestore(); }
});
