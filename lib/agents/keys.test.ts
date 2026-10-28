import { beforeEach, expect, it, vi } from "vitest";
import { CALLS_PER_MINUTE, CHANGES_PER_DAY, checkAgentCall, recordAgentCall, resolveAgentKey } from "./keys";
import { hashSecret } from "./oauth/secrets";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => ({}) }));
vi.mock("@/lib/db/rpc", () => ({ supabaseRpc: () => ({ call: mocks.call }) }));
beforeEach(() => { vi.clearAllMocks(); });

const resource = "https://wiki.test/api/mcp";
const personalKey = "cwk_AbCdEfGh0123456789-_AbCdEfGh0123456789-_x";
const accessToken = "cwa_AbCdEfGh0123456789-_AbCdEfGh0123456789-_x";
const keyId = "20000000-0000-4000-8000-000000000001";
const person = "30000000-0000-4000-8000-000000000001";
const space = "10000000-0000-4000-8000-000000000001";

it("rejects anything that is not a key or an access token without a database call", async () => {
  const refreshToken = "cwr_AbCdEfGh0123456789-_AbCdEfGh0123456789-_x";
  for (const bad of ["", "sk-abc", "Bearer cwk_abc", "CWK_abc", refreshToken, `cwk_${"a".repeat(300)}`]) {
    expect(await resolveAgentKey(bad, resource)).toBeNull();
  }
  expect(mocks.call).not.toHaveBeenCalled();
});

it("resolves a personal key by its hash and keeps only known scopes", async () => {
  mocks.call.mockResolvedValue({ id: keyId, name: "Laptop", owner_id: person, space_id: space, scopes: ["read", "write", "admin"] });
  expect(await resolveAgentKey(personalKey, resource)).toEqual({
    kind: "key", keyId, clientId: null, name: "Laptop", personId: person, spaceId: space, scopes: ["read", "write"],
  });
  expect(mocks.call).toHaveBeenCalledWith("resolve_agent_key", { p_hash: hashSecret(personalKey) });
});

it("resolves an OAuth access token for this resource as its grant", async () => {
  mocks.call.mockResolvedValue({ id: keyId, client_id: "https://claude.ai/oauth/claude-code", name: "Claude Code", owner_id: person, space_id: null, scopes: ["read", "spaces"] });
  expect(await resolveAgentKey(accessToken, resource)).toEqual({
    kind: "oauth", keyId, clientId: "https://claude.ai/oauth/claude-code", name: "Claude Code", personId: person, spaceId: null, scopes: ["read", "spaces"],
  });
  expect(mocks.call).toHaveBeenCalledWith("resolve_oauth_token", { p_hash: hashSecret(accessToken), p_resource: resource });
});

it("returns null for an unknown, revoked, expired or other-audience credential", async () => {
  mocks.call.mockResolvedValue(null);
  expect(await resolveAgentKey(personalKey, resource)).toBeNull();
  expect(await resolveAgentKey(accessToken, "https://elsewhere.test/api/mcp")).toBeNull();
});

it("allows calls under the limits", async () => {
  mocks.call.mockResolvedValue({ minute: CALLS_PER_MINUTE - 1, day_changes: CHANGES_PER_DAY - 1 });
  expect(await checkAgentCall(keyId, "write")).toEqual({ ok: true });
  expect(mocks.call).toHaveBeenCalledWith("agent_call_counts", { p_key: keyId });
});

it("stops any call after 60 in a minute", async () => {
  mocks.call.mockResolvedValue({ minute: CALLS_PER_MINUTE, day_changes: 0 });
  const check = await checkAgentCall(keyId, "read");
  expect(!check.ok && check.reason).toMatch(/60 calls per minute/);
});

it("caps changes at 500 a day but lets reads through", async () => {
  mocks.call.mockResolvedValue({ minute: 0, day_changes: CHANGES_PER_DAY });
  expect(await checkAgentCall(keyId, "read")).toEqual({ ok: true });
  for (const scope of ["write", "delete", "spaces", "settings"] as const) {
    const check = await checkAgentCall(keyId, scope);
    expect(!check.ok && check.reason).toMatch(/500 changes per day/);
  }
});

it("fails closed when the limit cannot be checked", async () => {
  const warning = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.call.mockRejectedValue(new Error("agent_call_counts: down"));
  try {
    expect((await checkAgentCall(keyId, "read")).ok).toBe(false);
  } finally { warning.mockRestore(); }
});

it("records a call with whole milliseconds, and no Space when none was named", async () => {
  mocks.call.mockResolvedValue(null);
  await recordAgentCall({ keyId, spaceId: space, tool: "search", scope: "read", ok: false, error: "boom", ms: 12.6, summary: "q=x" });
  expect(mocks.call).toHaveBeenLastCalledWith("record_agent_call", {
    p_key: keyId, p_space: space, p_tool: "search", p_scope: "read", p_ok: false, p_error: "boom", p_ms: 13, p_summary: "q=x",
  });
  await recordAgentCall({ keyId, spaceId: "", tool: "search", scope: "read", ok: false, error: "No Space", ms: -1, summary: "" });
  expect(mocks.call).toHaveBeenLastCalledWith("record_agent_call", expect.objectContaining({ p_space: null, p_ms: 0 }));
});

it("never throws when the log write fails", async () => {
  const warning = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.call.mockRejectedValue(new Error("record_agent_call: down"));
  try {
    await expect(recordAgentCall({ keyId, spaceId: space, tool: "search", scope: "read", ok: true, error: null, ms: 1, summary: "" })).resolves.toBeUndefined();
  } finally { warning.mockRestore(); }
});
