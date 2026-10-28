import { beforeEach, expect, it, vi } from "vitest";
import { ACCESS_TOKEN_SECONDS, exchangeCode, issueCode, refreshTokens, revokeToken } from "./store";
import { hashSecret, isCodeChallenge, isCodeVerifier, pkceChallenge } from "./secrets";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => ({}) }));
vi.mock("@/lib/db/rpc", () => ({ supabaseRpc: () => ({ call: mocks.call }) }));
beforeEach(() => { vi.clearAllMocks(); });

const resource = "https://wiki.test/api/mcp";

it("computes the RFC 7636 S256 example", () => {
  // RFC 7636 appendix B
  expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  expect(isCodeVerifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(true);
  expect(isCodeVerifier("short")).toBe(false);
  expect(isCodeChallenge("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
});

it("stores only the hash of a new code and returns the code once", async () => {
  mocks.call.mockResolvedValue("grant");
  const code = await issueCode({ clientId: "c", spaceId: null, scopes: ["read"], redirectUri: "http://localhost/cb", codeChallenge: "x", resource });
  expect(code).toMatch(/^cwc_[A-Za-z0-9_-]{43}$/);
  expect(mocks.call).toHaveBeenCalledWith("oauth_authorize", expect.objectContaining({ p_code_hash: hashSecret(code), p_resource: resource }));
  expect(JSON.stringify(mocks.call.mock.calls)).not.toContain(code);
});

it("turns an exchanged code into a bearer token set whose hashes went to the database", async () => {
  mocks.call.mockResolvedValue({ scopes: ["read", "write"], resource });
  const set = await exchangeCode({ code: "cwc_x", clientId: "c", redirectUri: "http://localhost/cb", challenge: "ch", resource });
  if ("error" in set) throw new Error(set.error);
  expect(set).toMatchObject({ token_type: "Bearer", expires_in: ACCESS_TOKEN_SECONDS, scope: "read write" });
  expect(set.access_token).toMatch(/^cwa_/);
  expect(set.refresh_token).toMatch(/^cwr_/);
  expect(mocks.call).toHaveBeenCalledWith("oauth_exchange_code", expect.objectContaining({
    p_code_hash: hashSecret("cwc_x"), p_access_hash: hashSecret(set.access_token), p_refresh_hash: hashSecret(set.refresh_token),
  }));
});

it("passes the database's RFC 6749 error through", async () => {
  mocks.call.mockResolvedValue({ error: "invalid_grant", error_description: "Refresh token already used or revoked" });
  expect(await refreshTokens({ refreshToken: "cwr_x", clientId: "c", resource: null, scopes: null }))
    .toEqual({ error: "invalid_grant", error_description: "Refresh token already used or revoked" });
});

it("revokes by hash", async () => {
  mocks.call.mockResolvedValue(null);
  await revokeToken("cwr_x", "c");
  expect(mocks.call).toHaveBeenCalledWith("oauth_revoke_token", { p_token_hash: hashSecret("cwr_x"), p_client_id: "c" });
});
