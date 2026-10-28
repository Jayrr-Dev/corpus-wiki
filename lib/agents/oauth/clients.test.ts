import { beforeEach, expect, it, vi } from "vitest";
import { ClientError, clientIdUrlProblem, registerClient, resolveClient } from "./clients";

const mocks = vi.hoisted(() => ({ getClient: vi.fn(), saveClient: vi.fn(), fetch: vi.fn() }));
vi.mock("./store", () => ({ getClient: mocks.getClient, saveClient: mocks.saveClient }));
vi.mock("./safeFetch", () => ({ fetchPublicJson: mocks.fetch }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveClient.mockImplementation(async (client) => ({ ...client, fetched_at: new Date().toISOString(), created_at: new Date().toISOString() }));
});

const url = "https://claude.ai/oauth/claude-code-client-metadata";
const document = { client_id: url, client_name: "Claude Code", redirect_uris: ["http://localhost/callback"], token_endpoint_auth_method: "none" };

it("accepts only https client_id URLs with a path", () => {
  expect(clientIdUrlProblem(url)).toBeNull();
  for (const bad of ["http://x.test/c", "https://x.test", "https://x.test/", "https://x.test/a/../b", "https://u@x.test/c", "nope"]) {
    expect(clientIdUrlProblem(bad), bad).not.toBeNull();
  }
});

it("fetches a metadata document and saves it as a cimd client", async () => {
  mocks.getClient.mockResolvedValue(null);
  mocks.fetch.mockResolvedValue(document);
  const client = await resolveClient(url);
  expect(client).toMatchObject({ client_id: url, name: "Claude Code", kind: "cimd", redirect_uris: ["http://localhost/callback"] });
  expect(mocks.fetch).toHaveBeenCalledWith(url);
});

it("refuses a document whose client_id is not its URL, or a confidential client", async () => {
  mocks.getClient.mockResolvedValue(null);
  mocks.fetch.mockResolvedValue({ ...document, client_id: "https://evil.test/c" });
  await expect(resolveClient(url)).rejects.toThrow(/must equal its URL/);
  mocks.fetch.mockResolvedValue({ ...document, token_endpoint_auth_method: "private_key_jwt" });
  await expect(resolveClient(url)).rejects.toThrow(/public clients/);
});

it("uses a fresh cached document without fetching, and a stale one only when the fetch fails", async () => {
  const fresh = { ...document, name: "Claude Code", kind: "cimd", fetched_at: new Date().toISOString() };
  mocks.getClient.mockResolvedValue(fresh);
  expect(await resolveClient(url)).toBe(fresh);
  expect(mocks.fetch).not.toHaveBeenCalled();

  const stale = { ...fresh, fetched_at: new Date(Date.now() - 2 * 86_400_000).toISOString() };
  mocks.getClient.mockResolvedValue(stale);
  mocks.fetch.mockRejectedValue(new Error("timeout"));
  expect(await resolveClient(url)).toBe(stale);

  mocks.getClient.mockResolvedValue({ ...stale, fetched_at: new Date(Date.now() - 30 * 86_400_000).toISOString() });
  await expect(resolveClient(url)).rejects.toBeInstanceOf(ClientError);
});

it("knows a registered client only by its kind", async () => {
  mocks.getClient.mockResolvedValue({ client_id: "cwd_x", kind: "dcr", redirect_uris: ["https://c.test/cb"] });
  expect((await resolveClient("cwd_x")).kind).toBe("dcr");
  mocks.getClient.mockResolvedValue(null);
  await expect(resolveClient("cwd_y")).rejects.toThrow(/Unknown client/);
});

it("registers a public client with a random id", async () => {
  const client = await registerClient({ client_name: "  My   agent ", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], grant_types: ["authorization_code", "refresh_token"] });
  expect(client.client_id).toMatch(/^cwd_[A-Za-z0-9_-]{22}$/);
  expect(client).toMatchObject({ name: "My agent", kind: "dcr" });
});

it("refuses registrations it cannot honor", async () => {
  await expect(registerClient({ redirect_uris: [] })).rejects.toThrow(/redirect_uris/);
  await expect(registerClient({ redirect_uris: ["http://evil.test/cb"] })).rejects.toThrow(/https/);
  await expect(registerClient({ redirect_uris: ["https://c.test/cb"], token_endpoint_auth_method: "client_secret_basic" })).rejects.toThrow(/public/);
  await expect(registerClient({ redirect_uris: ["https://c.test/cb"], grant_types: ["client_credentials"] })).rejects.toThrow(/grant_types/);
  expect(mocks.saveClient).not.toHaveBeenCalled();
});
