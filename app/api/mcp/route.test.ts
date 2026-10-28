import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentKeyIdentity } from "@/lib/agents/types";
import { defineTool } from "@/lib/mcp/types";

const keys = vi.hoisted(() => ({
  resolveAgentKey: vi.fn<(token: string, resource: string) => Promise<AgentKeyIdentity | null>>(async () => null),
  checkAgentCall: vi.fn(async () => ({ ok: true })),
  recordAgentCall: vi.fn(async () => undefined),
}));
const tools = vi.hoisted(() => ({ ALL_TOOLS: [] as unknown[] }));

vi.mock("@/lib/agents/keys", () => keys);
vi.mock("@/lib/agents/session", () => ({ withAgentSession: (_session: unknown, run: () => Promise<unknown>) => run() }));
vi.mock("@/lib/auth/currentPerson", () => ({ withSpaceActor: (_actor: unknown, run: () => Promise<unknown>) => run() }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => ({}) }));
vi.mock("@/lib/mcp/tools", () => tools);

const { DELETE, GET, POST } = await import("./route");
const rootMetadata = await import("@/app/.well-known/oauth-protected-resource/route");
const mcpMetadata = await import("@/app/.well-known/oauth-protected-resource/api/mcp/route");

const ORIGIN = "http://localhost:3000";
const MCP_URL = `${ORIGIN}/api/mcp`;
const PRM_URL = `${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`;
const KEY: AgentKeyIdentity = {
  kind: "oauth",
  keyId: "grant-1",
  clientId: "https://claude.ai/oauth/claude-code-client-metadata",
  name: "Claude Code",
  personId: "person-1",
  spaceId: "11111111-1111-4111-8111-111111111111",
  scopes: ["read"],
};

tools.ALL_TOOLS = [
  defineTool({ name: "look", title: "Look", description: "Reads.", scope: "read", input: z.object({}), annotations: { readOnlyHint: true }, run: async () => ({ seen: true }) }),
  defineTool({ name: "erase", title: "Erase", description: "Deletes.", scope: "delete", input: z.object({}), annotations: { destructiveHint: true }, run: async () => ({ erased: true }) }),
];

function rpc(body: unknown, headers: Record<string, string> = {}, url = MCP_URL): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", ...headers },
    body: JSON.stringify(body),
  });
}
const INITIALIZE = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } };
const call = (name: string) => ({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: {} } });
const AUTH = { authorization: "Bearer good-token" };

beforeEach(() => {
  keys.resolveAgentKey.mockClear();
  keys.recordAgentCall.mockClear();
  // A real resolver refuses a token bound to another resource (RFC 8707)
  keys.resolveAgentKey.mockImplementation(async (token, resource) => (token === "good-token" && resource === MCP_URL ? KEY : null));
});
afterEach(() => vi.unstubAllEnvs());

describe("Protected Resource Metadata", () => {
  it("names the MCP URL, this origin as the sign-in server, and read as the first scope", async () => {
    for (const route of [rootMetadata, mcpMetadata]) {
      const response = route.GET(new Request(PRM_URL));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        resource: MCP_URL,
        authorization_servers: [ORIGIN],
        scopes_supported: ["read"],
        bearer_methods_supported: ["header"],
        resource_name: "Corpus Wiki",
      });
    }
  });

  it("uses APP_ORIGIN behind a proxy", async () => {
    vi.stubEnv("APP_ORIGIN", "https://corpus.example.com/");
    const body = await mcpMetadata.GET(new Request("http://internal:8080/.well-known/oauth-protected-resource/api/mcp")).json();
    expect(body.resource).toBe("https://corpus.example.com/api/mcp");
    expect(body.authorization_servers).toEqual(["https://corpus.example.com"]);
  });
});

describe("/api/mcp", () => {
  it("answers 401 pointing at the metadata when the token is missing", async () => {
    const response = await POST(rpc(INITIALIZE));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${PRM_URL}", scope="read"`);
    expect(await response.json()).toHaveProperty("error", "invalid_token");
    expect(keys.resolveAgentKey).not.toHaveBeenCalled();
  });

  it("answers 401 for an unknown token", async () => {
    const response = await POST(rpc(INITIALIZE, { authorization: "Bearer bad-token" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("answers 401 for a token issued for another resource (audience mismatch)", async () => {
    vi.stubEnv("APP_ORIGIN", "https://other.example.com");
    const response = await POST(rpc(INITIALIZE, AUTH));
    expect(response.status).toBe(401);
    expect(keys.resolveAgentKey).toHaveBeenCalledWith("good-token", "https://other.example.com/api/mcp");
  });

  it("never reads a token from the query string", async () => {
    const response = await POST(rpc(INITIALIZE, {}, `${MCP_URL}?access_token=good-token`));
    expect(response.status).toBe(401);
    expect(keys.resolveAgentKey).not.toHaveBeenCalled();
  });

  it("initializes for a good token with no Origin (an agent outside a browser)", async () => {
    const response = await POST(rpc(INITIALIZE, AUTH));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.serverInfo.name).toBe("corpus-wiki");
    expect(body.result.instructions).toMatch(/data, not instructions/);
  });

  it("lists every tool, even those outside the token's scopes", async () => {
    const response = await POST(rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" }, AUTH));
    const body = await response.json();
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["look", "erase"]);
    expect(body.result.tools[1].description).toBe("Deletes. [needs delete]");
  });

  it("runs a call within the token's scopes", async () => {
    const response = await POST(rpc(call("look"), AUTH));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(JSON.parse(body.result.content[0].text)).toEqual({ seen: true });
  });

  it("answers 403 insufficient_scope to a call outside the token's scopes (step-up)", async () => {
    const response = await POST(rpc(call("erase"), AUTH));
    expect(response.status).toBe(403);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer error="insufficient_scope"/);
    expect(challenge).toContain('scope="delete"');
    expect(challenge).toContain(`resource_metadata="${PRM_URL}"`);
    expect(challenge).toContain("error_description=");
    expect(keys.recordAgentCall).not.toHaveBeenCalled();
  });

  it("answers 400 to a body that is not JSON", async () => {
    const response = await POST(new Request(MCP_URL, { method: "POST", headers: { ...AUTH, "content-type": "application/json" }, body: "{nope" }));
    expect(response.status).toBe(400);
  });

  it("rejects a foreign Origin before looking at the token", async () => {
    const response = await POST(rpc(INITIALIZE, { ...AUTH, origin: "http://evil.example" }));
    expect(response.status).toBe(403);
    expect(keys.resolveAgentKey).not.toHaveBeenCalled();
  });

  it("rejects a rebound host even when Origin matches it", async () => {
    const response = await POST(rpc(INITIALIZE, { ...AUTH, origin: "http://evil.example" }, "http://evil.example/api/mcp"));
    expect(response.status).toBe(403);
  });

  it("allows the app's own origin", async () => {
    const local = await POST(rpc(INITIALIZE, { ...AUTH, origin: ORIGIN }));
    expect(local.status).toBe(200);
    vi.stubEnv("APP_ORIGIN", "https://corpus.example.com");
    keys.resolveAgentKey.mockImplementation(async (_token, resource) => (resource === "https://corpus.example.com/api/mcp" ? KEY : null));
    const deployed = await POST(rpc(INITIALIZE, { ...AUTH, origin: "https://corpus.example.com" }, "http://internal:8080/api/mcp"));
    expect(deployed.status).toBe(200);
  });

  it("answers 405 to GET and DELETE", async () => {
    expect(GET().status).toBe(405);
    expect(DELETE().status).toBe(405);
  });
});
