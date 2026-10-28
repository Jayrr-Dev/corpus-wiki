import { beforeEach, expect, it, vi } from "vitest";
import { createAgentKey, revokeAgentKey } from "./agentKeys";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), call: vi.fn(), agent: vi.fn() }));
vi.mock("@/lib/auth/requireUser", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/agents/session", () => ({ currentAgentSession: mocks.agent }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({}) }));
vi.mock("@/lib/db/rpc", () => ({ supabaseRpc: () => ({ call: mocks.call }) }));
beforeEach(() => { vi.clearAllMocks(); mocks.agent.mockReturnValue(null); });

const space = "10000000-0000-4000-8000-000000000001";
const keyId = "20000000-0000-4000-8000-000000000001";

// Runs an action that is expected to fail, without its error log in the output
async function failing<T>(run: () => Promise<T>): Promise<T> {
  const warning = vi.spyOn(console, "error").mockImplementation(() => {});
  try { return await run(); } finally { warning.mockRestore(); }
}

it("creates a key with known scopes in a fixed order and returns the plain key once", async () => {
  mocks.call.mockResolvedValue({ id: keyId, key: "cwk_secret" });
  const result = await createAgentKey({ name: "  Laptop ", spaceId: space, scopes: ["write", "read", "admin", "read"], expiresAt: null });
  expect(result).toEqual({ ok: true, key: "cwk_secret", keyId });
  expect(mocks.requireUser).toHaveBeenCalledOnce();
  expect(mocks.call).toHaveBeenCalledWith("create_agent_key", { p_name: "Laptop", p_space: space, p_scopes: ["read", "write"], p_expires_at: null });
});

it("refuses the Spaces scope on a key tied to one Space", async () => {
  const result = await failing(() => createAgentKey({ name: "x", spaceId: space, scopes: ["spaces"], expiresAt: null }));
  expect(result).toEqual({ ok: false, error: "The Spaces scope needs a key for all Spaces." });
  expect(mocks.call).not.toHaveBeenCalled();
});

it("refuses an expiry in the past and a key with no scopes", async () => {
  expect((await failing(() => createAgentKey({ name: "x", spaceId: null, scopes: ["read"], expiresAt: "2000-01-01T00:00:00Z" }))).ok).toBe(false);
  expect((await failing(() => createAgentKey({ name: "x", spaceId: null, scopes: [], expiresAt: null }))).ok).toBe(false);
  expect(mocks.call).not.toHaveBeenCalled();
});

it("never lets an agent manage keys", async () => {
  mocks.agent.mockReturnValue({ key: { personId: "p" }, spaceId: space });
  const result = await failing(() => revokeAgentKey(keyId));
  expect(result).toEqual({ ok: false, error: "Agents cannot manage agent keys." });
  expect(mocks.call).not.toHaveBeenCalled();
});

it("revokes a key by id", async () => {
  mocks.call.mockResolvedValue(null);
  expect(await revokeAgentKey(keyId)).toEqual({ ok: true });
  expect(mocks.call).toHaveBeenCalledWith("revoke_agent_key", { p_id: keyId });
});
