import { beforeEach, expect, it, vi } from "vitest";
import { handleRegisterRequest } from "./registerEndpoint";

const mocks = vi.hoisted(() => ({ saveClient: vi.fn() }));
vi.mock("./store", () => ({ saveClient: mocks.saveClient, getClient: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveClient.mockImplementation(async (client) => ({ ...client, fetched_at: null, created_at: "2026-10-28T12:00:00Z" }));
});

function register(body: unknown, address = "203.0.113.9") {
  return new Request("https://wiki.test/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": address },
    body: JSON.stringify(body),
  });
}

it("registers a public client and answers RFC 7591 fields", async () => {
  const response = await handleRegisterRequest(register({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }));
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({
    client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], client_id_issued_at: 1793188800,
  });
});

it("names a bad redirect URI as invalid_redirect_uri", async () => {
  const response = await handleRegisterRequest(register({ redirect_uris: ["http://evil.test/cb"] }));
  expect(response.status).toBe(400);
  expect((await response.json()).error).toBe("invalid_redirect_uri");
});

it("slows one address down after 20 registrations an hour", async () => {
  const body = { redirect_uris: ["https://c.test/cb"] };
  for (let i = 0; i < 20; i++) expect((await handleRegisterRequest(register(body, "198.51.100.7"))).status).toBe(201);
  expect((await handleRegisterRequest(register(body, "198.51.100.7"))).status).toBe(429);
  expect((await handleRegisterRequest(register(body, "198.51.100.8"))).status).toBe(201);
});
