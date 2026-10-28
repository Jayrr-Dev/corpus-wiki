import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resolveAgentKey } from "@/lib/agents/keys";
import { bearerToken } from "@/lib/auth/apiKey";
import { createMcpServer } from "@/lib/mcp/server";
import { originAllowed } from "./origin";

// =====================================================================
// MCP SERVER for outside agents (Claude Code, Claude Desktop, any MCP
// client). Stateless Streamable HTTP: every POST carries its own agent
// key and gets a fresh server, so nothing is kept between requests.
//
// Auth: `Authorization: Bearer cwk_...`, an agent key made in Settings.
// The proxy lets /api/mcp through signed out; the key is checked here.
// Design: docs/mcp-server-plan.md
// =====================================================================

// A tool can run the upload pipeline or rewrite a page; give it time
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  if (!originAllowed(request)) return fail(403, "Origin not allowed.");
  const token = bearerToken(request.headers.get("authorization"));
  const key = token ? await resolveAgentKey(token) : null;
  if (!key) return unauthorized(token ? "Invalid, revoked or expired agent key." : "Send Authorization: Bearer <agent key>. Make one in Settings, Agents.");

  const server = createMcpServer(key);
  // JSON responses, not a stream: the answer is whole when handleRequest resolves
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

// A stateless server keeps no stream to open (GET) or session to end (DELETE)
export function GET(): Response {
  return methodNotAllowed();
}

export function DELETE(): Response {
  return methodNotAllowed();
}

function unauthorized(message: string): Response {
  return Response.json({ error: message }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="corpus-wiki"' } });
}

function methodNotAllowed(): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. Send MCP requests as POST." }, id: null },
    { status: 405, headers: { Allow: "POST" } },
  );
}

function fail(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}
