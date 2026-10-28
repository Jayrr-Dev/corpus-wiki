import { beforeEach, expect, it, vi } from "vitest";
import type { AgentSession } from "@/lib/agents/types";
import { spacesTools } from "./spaces";

const mocks = vi.hoisted(() => ({ session: vi.fn(), call: vi.fn(), rename: vi.fn(), list: vi.fn(), eq: vi.fn() }));
vi.mock("@/lib/agents/session", () => ({ currentAgentSession: mocks.session }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => ({}) }));
vi.mock("@/lib/db/rpc", () => ({ supabaseRpc: () => ({ call: mocks.call }) }));
vi.mock("@/lib/server-actions/spaces", () => ({ renameSpace: mocks.rename }));
vi.mock("@/lib/spaces/subtitle", () => ({ savedSpaceSubtitle: (space: { name: string; subtitle?: string | null; subtitle_for_name?: string | null }) => (space.subtitle_for_name === space.name ? space.subtitle : null) }));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => {
    const query = { select: () => query, eq: (...args: unknown[]) => { mocks.eq(...args); return query; }, order: () => query, then: (resolve: (value: unknown) => void) => resolve({ data: mocks.list(), error: null }) };
    return { from: () => query };
  },
}));

const person = "20000000-0000-4000-8000-000000000001";
const home = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const session = (spaceId: string | null): AgentSession => ({ key: { keyId: "k", name: "Agent", personId: person, spaceId, scopes: ["spaces"] }, spaceId: home });
const tool = (name: string) => spacesTools.find((entry) => entry.name === name)!;
const run = (name: string, args: unknown) => (tool(name).run as (args: unknown, context: unknown) => Promise<unknown>)(tool(name).input.parse(args), { session: session(null) });
const rows = [
  { id: home, name: "Home", created_at: "2026-10-01T00:00:00Z", owner_id: person, subtitle: "A wiki", subtitle_for_name: "Home" },
  { id: other, name: "Work", created_at: "2026-10-02T00:00:00Z", owner_id: person, subtitle: "Old", subtitle_for_name: "Before" },
];

beforeEach(() => { vi.clearAllMocks(); mocks.session.mockReturnValue(session(null)); mocks.list.mockReturnValue(rows); });

it("puts every tool under the spaces scope, with list read-only", () => {
  expect(spacesTools.map((entry) => [entry.name, entry.scope])).toEqual([["list_spaces", "spaces"], ["create_space", "spaces"], ["rename_space", "spaces"]]);
  expect(tool("list_spaces").annotations.readOnlyHint).toBe(true);
  expect(tool("create_space").annotations.readOnlyHint).toBe(false);
  expect(tool("rename_space").annotations.readOnlyHint).toBe(false);
  for (const entry of spacesTools) expect(Object.keys(entry.input.shape)).not.toContain("space");
});

it("lists the owner's Spaces and marks the one this call acts in", async () => {
  expect(await run("list_spaces", {})).toEqual({ spaces: [
    { id: home, name: "Home", subtitle: "A wiki", createdAt: "2026-10-01T00:00:00Z", current: true },
    { id: other, name: "Work", subtitle: null, createdAt: "2026-10-02T00:00:00Z", current: false },
  ] });
  expect(mocks.eq).toHaveBeenCalledWith("owner_id", person);
});

it("creates a Space through the database function, not the cookie-setting action", async () => {
  mocks.call.mockResolvedValue({ id: other, name: "Work", created_at: "2026-10-02T00:00:00Z", owner_id: person });
  expect(await run("create_space", { name: "  Work " })).toEqual({ space: { id: other, name: "Work", subtitle: null, createdAt: "2026-10-02T00:00:00Z", current: false } });
  expect(mocks.call).toHaveBeenCalledWith("create_space", { p_name: "Work" });
});

it("renames only a Space the owner has", async () => {
  mocks.rename.mockResolvedValue({ ok: true, space: { ...rows[1], name: "Job" } });
  expect(await run("rename_space", { id: other, name: "Job" })).toMatchObject({ space: { id: other, name: "Job" } });
  expect(mocks.rename).toHaveBeenCalledWith(other, "Job");

  await expect(run("rename_space", { id: "10000000-0000-4000-8000-000000000009", name: "Job" })).rejects.toThrow("Space not found or not owned by you.");
  expect(mocks.rename).toHaveBeenCalledOnce();
});

it("passes on the rename action's error", async () => {
  mocks.rename.mockResolvedValue({ ok: false, error: "Use a space name between 1 and 80 characters" });
  await expect(run("rename_space", { id: other, name: "Job" })).rejects.toThrow("Use a space name between 1 and 80 characters");
});

it("refuses every tool for a key tied to one Space", async () => {
  mocks.session.mockReturnValue(session(home));
  await expect(run("list_spaces", {})).rejects.toThrow("tied to one Space");
  await expect(run("create_space", { name: "Work" })).rejects.toThrow("tied to one Space");
  await expect(run("rename_space", { id: other, name: "Job" })).rejects.toThrow("tied to one Space");
  expect(mocks.call).not.toHaveBeenCalled();
  expect(mocks.rename).not.toHaveBeenCalled();
});

it("refuses outside an agent session", async () => {
  mocks.session.mockReturnValue(null);
  await expect(run("list_spaces", {})).rejects.toThrow("only for an agent key");
});

it("rejects names that are empty or too long before calling anything", () => {
  expect(() => tool("create_space").input.parse({ name: "  " })).toThrow();
  expect(() => tool("create_space").input.parse({ name: "x".repeat(81) })).toThrow();
  expect(() => tool("rename_space").input.parse({ id: "not-an-id", name: "Job" })).toThrow();
});
