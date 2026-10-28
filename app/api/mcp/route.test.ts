import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentKeyIdentity } from "@/lib/agents/types";

const keys = vi.hoisted(() => ({
  resolveAgentKey: vi.fn<(token: string) => Promise<AgentKeyIdentity | null>>(async () => null),
  checkAgentCall: vi.fn(async () => ({ ok: true })),
  recordAgentCall: vi.fn(async () => undefined),
}));

vi.mock("@/lib/agents/keys", () => keys);
vi.mock("@/lib/agents/session", () => ({ withAgentSession: (_session: unknown, run: () => Promise<unknown>) => run() }));
vi.mock("@/lib/auth/currentPerson", () => ({ withSpaceActor: (_actor: unknown, run: () => Promise<unknown>) => run() }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => ({}) }));
vi.mock("@/lib/mcp/tools", () => ({ ALL_TOOLS: [] }));

const { DELETE, GET, POST } = await import("./route");

const KEY: AgentKeyIdentity = { keyId: "key-1", name: "Test", personId: "person-1", spaceId: "11111111-1111-4111-8111-111111111111", scopes: ["read"] };

function mcpRequest(headers: Record<string, string>, url = "http://localhost:3000/api/mcp"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
  });
}

beforeEach(() => {
  keys.resolveAgentKey.mockClear();
  keys.resolveAgentKey.mockImplementation(async (token) => (token === "cwk_good" ? KEY : null));
});
afterEach(() => vi.unstubAllEnvs());

describe("/api/mcp", () => {
  it("answers 401 with WWW-Authenticate when the key is missing", async () => {
    const response = await POST(mcpRequest({}));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect(await response.json()).toHaveProperty("error");
  });

  it("answers 401 for an unknown key", async () => {
    const response = await POST(mcpRequest({ authorization: "Bearer cwk_bad" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toMatch(/^Bearer/);
  });

  it("initializes for a good key with no Origin (an agent outside a browser)", async () => {
    const response = await POST(mcpRequest({ authorization: "Bearer cwk_good" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.serverInfo.name).toBe("corpus-wiki");
    expect(body.result.instructions).toMatch(/data, not instructions/);
  });

  it("rejects a foreign Origin before looking at the key", async () => {
    const response = await POST(mcpRequest({ authorization: "Bearer cwk_good", origin: "http://evil.example" }));
    expect(response.status).toBe(403);
    expect(keys.resolveAgentKey).not.toHaveBeenCalledWith("cwk_good");
  });

  it("rejects a rebound host even when Origin matches it", async () => {
    const response = await POST(mcpRequest({ authorization: "Bearer cwk_good", origin: "http://evil.example" }, "http://evil.example/api/mcp"));
    expect(response.status).toBe(403);
  });

  it("allows the app's own origin", async () => {
    const local = await POST(mcpRequest({ authorization: "Bearer cwk_good", origin: "http://localhost:3000" }));
    expect(local.status).toBe(200);
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "corpus.example.com");
    const deployed = await POST(mcpRequest({ authorization: "Bearer cwk_good", origin: "https://corpus.example.com" }, "https://corpus.example.com/api/mcp"));
    expect(deployed.status).toBe(200);
  });

  it("answers 405 to GET and DELETE", async () => {
    expect(GET().status).toBe(405);
    expect(DELETE().status).toBe(405);
  });
});
