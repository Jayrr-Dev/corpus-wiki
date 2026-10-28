import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { recordAgentCall, resolveAgentKey } from "@/lib/agents/keys";
import { bearerToken } from "@/lib/auth/apiKey";
import { createMcpServer, missingScope } from "@/lib/mcp/server";
import { originAllowed } from "./origin";
import { insufficientScope, mcpResourceUrl, unauthorized } from "./resource";

// =====================================================================
// MCP SERVER for outside agents (Claude connectors, Claude Code, any MCP
// client). Stateless Streamable HTTP: every POST carries its own token
// and gets a fresh server, so nothing is kept between requests.
//
// Auth (MCP authorization spec): an OAuth access token issued for this
// exact URL, or a personal key made in Settings, in the Authorization
// header only, never the query string. No token, or a bad one: 401
// pointing at the Protected Resource Metadata, which starts sign-in.
// A call outside the token's scopes: 403 insufficient_scope (step-up).
// The proxy lets /api/mcp through signed out. Design: docs/mcp-server-plan.md
// =====================================================================

// A tool can run the upload pipeline or rewrite a page; give it time
export const maxDuration = 300;

// Vercel's request body limit; upload_file keeps files small enough to fit (lib/mcp/tools/write.ts)
const MAX_BODY_BYTES = 4.5 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  if (!originAllowed(request)) return Response.json({ error: "Origin not allowed." }, { status: 403 });
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return unauthorized(request, "Sign in, or send Authorization: Bearer <token>.");
  const key = await resolveAgentKey(token, mcpResourceUrl(request));
  if (!key) return unauthorized(request, "The token is unknown, expired, revoked or meant for another server.");

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const missing = missingScope(key, body.value);
  if (missing) {
    const reason = `${missing.tool} needs the "${missing.scope}" scope.`;
    // The person sees refused calls in Settings, Agents, beside the ones that ran
    await recordAgentCall({ keyId: key.keyId, spaceId: key.spaceId ?? "", tool: missing.tool, scope: missing.scope, ok: false, error: reason, ms: 0, summary: "" });
    return insufficientScope(request, missing.scope, reason);
  }

  const server = createMcpServer(key);
  // JSON responses, not a stream: the answer is whole when handleRequest resolves
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, { parsedBody: body.value });
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

// The route reads the body itself to find the tools a call needs
async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const tooLarge = { ok: false as const, response: rpcError(413, -32000, "Request body too large.") };
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooLarge;
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return tooLarge;
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: rpcError(400, -32700, "Parse error: the body is not valid JSON.") };
  }
}

function methodNotAllowed(): Response {
  return rpcError(405, -32000, "Method not allowed. Send MCP requests as POST.", { Allow: "POST" });
}

function rpcError(status: number, code: number, message: string, headers?: Record<string, string>): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status, headers });
}
