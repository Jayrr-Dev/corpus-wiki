import { beforeEach, expect, it, vi } from "vitest";
import { parseAuthorizeRequest } from "./authorizeRequest";
import { ClientError } from "./clients";

const mocks = vi.hoisted(() => ({ resolveClient: vi.fn() }));
vi.mock("./clients", async (original) => ({ ...(await original<typeof import("./clients")>()), resolveClient: mocks.resolveClient }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveClient.mockResolvedValue({ client_id: "cwd_x", name: "Agent", kind: "dcr", redirect_uris: ["http://localhost/callback"] });
});

const issuer = "https://wiki.test";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const good = {
  response_type: "code", client_id: "cwd_x", redirect_uri: "http://localhost:4242/callback", state: "s1",
  code_challenge: challenge, code_challenge_method: "S256", scope: "read write offline_access bogus", resource: "https://wiki.test/api/mcp",
};
const query = (overrides: Record<string, string | undefined> = {}) => {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...good, ...overrides })) if (value !== undefined) params.set(name, value);
  return params;
};

it("accepts a good request and keeps only known scopes", async () => {
  const parsed = await parseAuthorizeRequest(query(), issuer);
  expect(parsed).toMatchObject({ kind: "ok", request: {
    redirectUri: "http://localhost:4242/callback", state: "s1", codeChallenge: challenge,
    resource: "https://wiki.test/api/mcp", requestedScopes: ["read", "write"], loopbackOnly: true,
  } });
});

it("shows, never redirects, a bad client or redirect URI", async () => {
  expect((await parseAuthorizeRequest(query({ redirect_uri: "https://evil.test/cb" }), issuer)).kind).toBe("show");
  expect((await parseAuthorizeRequest(query({ client_id: undefined }), issuer)).kind).toBe("show");
  mocks.resolveClient.mockRejectedValue(new ClientError("Unknown client. Register it first."));
  expect(await parseAuthorizeRequest(query(), issuer)).toEqual({ kind: "show", message: "Unknown client. Register it first." });
});

it("refuses repeated parameters", async () => {
  const params = query();
  params.append("redirect_uri", "https://evil.test/cb");
  expect((await parseAuthorizeRequest(params, issuer)).kind).toBe("show");
});

it("uses the one registered redirect URI when none is named", async () => {
  const parsed = await parseAuthorizeRequest(query({ redirect_uri: undefined }), issuer);
  expect(parsed.kind === "ok" && parsed.request.redirectUri).toBe("http://localhost/callback");
});

it("sends other problems back to the client with state and iss", async () => {
  const cases: [Record<string, string | undefined>, string][] = [
    [{ response_type: "token" }, "unsupported_response_type"],
    [{ code_challenge: undefined }, "invalid_request"],
    [{ code_challenge_method: "plain" }, "invalid_request"],
    [{ resource: "https://other.test/api/mcp" }, "invalid_target"],
  ];
  for (const [overrides, error] of cases) {
    const parsed = await parseAuthorizeRequest(query(overrides), issuer);
    if (parsed.kind !== "redirect") throw new Error(`expected a redirect for ${error}`);
    const url = new URL(parsed.url);
    expect(url.origin + url.pathname).toBe("http://localhost:4242/callback");
    expect(url.searchParams.get("error")).toBe(error);
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("iss")).toBe(issuer);
  }
});

it("binds tokens to this server when the client names no resource", async () => {
  const parsed = await parseAuthorizeRequest(query({ resource: undefined }), issuer);
  expect(parsed.kind === "ok" && parsed.request.resource).toBe("https://wiki.test/api/mcp");
});
