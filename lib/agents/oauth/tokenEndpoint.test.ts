import { beforeEach, expect, it, vi } from "vitest";
import { handleRevokeRequest, handleTokenRequest } from "./tokenEndpoint";
import { pkceChallenge } from "./secrets";

const mocks = vi.hoisted(() => ({ exchangeCode: vi.fn(), refreshTokens: vi.fn(), revokeToken: vi.fn() }));
vi.mock("./store", () => mocks);
beforeEach(() => { vi.clearAllMocks(); delete process.env.APP_ORIGIN; });

const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const tokens = { access_token: "cwa_a", token_type: "Bearer", expires_in: 3600, refresh_token: "cwr_r", scope: "read" };

function post(path: string, body: Record<string, string> | string, headers: Record<string, string> = {}) {
  return new Request(`https://wiki.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: typeof body === "string" ? body : new URLSearchParams(body).toString(),
  });
}

it("exchanges a code with the S256 of the verifier and a canonical resource", async () => {
  mocks.exchangeCode.mockResolvedValue(tokens);
  const response = await handleTokenRequest(post("/oauth/token", {
    grant_type: "authorization_code", code: "cwc_c", redirect_uri: "http://localhost:1/cb", code_verifier: verifier,
    client_id: "cwd_x", resource: "https://wiki.test/api/mcp/",
  }));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual(tokens);
  expect(mocks.exchangeCode).toHaveBeenCalledWith({
    code: "cwc_c", clientId: "cwd_x", redirectUri: "http://localhost:1/cb", challenge: pkceChallenge(verifier), resource: "https://wiki.test/api/mcp",
  });
});

it("answers RFC 6749 errors", async () => {
  mocks.exchangeCode.mockResolvedValue({ error: "invalid_grant", error_description: "PKCE code_verifier does not match" });
  const base = { grant_type: "authorization_code", code: "cwc_c", redirect_uri: "http://localhost/cb", code_verifier: verifier, client_id: "cwd_x" };
  const cases: [Request, number, string][] = [
    [post("/oauth/token", base), 400, "invalid_grant"],
    [post("/oauth/token", { ...base, code_verifier: "short" }), 400, "invalid_request"],
    [post("/oauth/token", { ...base, client_id: "" }), 401, "invalid_client"],
    [post("/oauth/token", { ...base, resource: "https://other.test/api/mcp" }), 400, "invalid_target"],
    [post("/oauth/token", { ...base, grant_type: "password" }), 400, "unsupported_grant_type"],
    [post("/oauth/token", "grant_type=refresh_token&grant_type=refresh_token&client_id=c"), 400, "invalid_request"],
    [post("/oauth/token", base, { "Content-Type": "application/json" }), 400, "invalid_request"],
  ];
  for (const [request, status, error] of cases) {
    const response = await handleTokenRequest(request);
    expect(response.status, error).toBe(status);
    expect((await response.json()).error).toBe(error);
  }
});

it("refreshes, dropping offline_access and refusing unknown scopes", async () => {
  mocks.refreshTokens.mockResolvedValue(tokens);
  const ok = await handleTokenRequest(post("/oauth/token", { grant_type: "refresh_token", refresh_token: "cwr_r", client_id: "cwd_x", scope: "read offline_access" }));
  expect(ok.status).toBe(200);
  expect(mocks.refreshTokens).toHaveBeenCalledWith({ refreshToken: "cwr_r", clientId: "cwd_x", resource: null, scopes: ["read"] });
  const bad = await handleTokenRequest(post("/oauth/token", { grant_type: "refresh_token", refresh_token: "cwr_r", client_id: "cwd_x", scope: "admin" }));
  expect((await bad.json()).error).toBe("invalid_scope");
});

it("takes the client_id from HTTP Basic when the form has none", async () => {
  mocks.refreshTokens.mockResolvedValue(tokens);
  await handleTokenRequest(post("/oauth/token", { grant_type: "refresh_token", refresh_token: "cwr_r" }, { Authorization: `Basic ${Buffer.from("cwd_x:").toString("base64")}` }));
  expect(mocks.refreshTokens).toHaveBeenCalledWith(expect.objectContaining({ clientId: "cwd_x" }));
});

it("hides database failures behind a server_error", async () => {
  const warning = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.refreshTokens.mockRejectedValue(new Error("db down"));
  try {
    const response = await handleTokenRequest(post("/oauth/token", { grant_type: "refresh_token", refresh_token: "cwr_r", client_id: "c" }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("db down");
  } finally { warning.mockRestore(); }
});

it("revokes our tokens and answers 200 for any well-formed request", async () => {
  expect((await handleRevokeRequest(post("/oauth/revoke", { token: "cwr_r", client_id: "cwd_x" }))).status).toBe(200);
  expect(mocks.revokeToken).toHaveBeenCalledWith("cwr_r", "cwd_x");
  expect((await handleRevokeRequest(post("/oauth/revoke", { token: "something-else" }))).status).toBe(200);
  expect(mocks.revokeToken).toHaveBeenCalledOnce();
  expect((await handleRevokeRequest(post("/oauth/revoke", {}))).status).toBe(400);
});
