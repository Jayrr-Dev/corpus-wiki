import type { AgentScope } from "@/lib/agents/scopes";

// =====================================================================
// WHERE THIS MCP SERVER LIVES, as OAuth sees it (MCP authorization spec,
// RFC 9728 and RFC 8707). Tokens are bound to the exact MCP URL, so it
// is built one way everywhere. Behind a proxy that rewrites the host,
// set APP_ORIGIN (for example https://corpus.example.com).
// =====================================================================

export const MCP_PATH = "/api/mcp";
export const RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;
// The scope a client asks for at first sign-in
export const FIRST_SCOPE: AgentScope = "read";

// The app's public origin: APP_ORIGIN when set, else the request's own
export function appOrigin(request: Request): string {
  const configured = process.env.APP_ORIGIN?.trim();
  return configured ? new URL(configured).origin : new URL(request.url).origin;
}

// The canonical MCP server URL: the origin plus /api/mcp, no trailing slash
export function mcpResourceUrl(request: Request): string {
  return `${appOrigin(request)}${MCP_PATH}`;
}

export function resourceMetadataUrl(request: Request): string {
  return `${appOrigin(request)}${RESOURCE_METADATA_PATH}`;
}

// PROTECTED RESOURCE METADATA (RFC 9728): tells a client which server signs it in.
// scopes_supported lists the minimum a client should ask for; more come by step-up.
export function protectedResourceMetadata(request: Request) {
  const origin = appOrigin(request);
  return {
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [origin],
    scopes_supported: [FIRST_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Corpus Wiki",
  };
}

// Quotes a value for a WWW-Authenticate parameter (RFC 9110 quoted-string)
function quoted(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

// 401: no token, or one that is unknown, expired, revoked or meant for another resource
export function unauthorized(request: Request, message: string): Response {
  const challenge = `Bearer resource_metadata=${quoted(resourceMetadataUrl(request))}, scope=${quoted(FIRST_SCOPE)}`;
  return Response.json({ error: "invalid_token", error_description: message }, { status: 401, headers: { "WWW-Authenticate": challenge } });
}

// 403 STEP-UP: the token is good but lacks the scope this call needs, so the
// client asks the person to grant it
export function insufficientScope(request: Request, scope: string, message: string): Response {
  const challenge = [
    'Bearer error="insufficient_scope"',
    `scope=${quoted(scope)}`,
    `resource_metadata=${quoted(resourceMetadataUrl(request))}`,
    `error_description=${quoted(message)}`,
  ].join(", ");
  return Response.json({ error: "insufficient_scope", error_description: message, scope }, { status: 403, headers: { "WWW-Authenticate": challenge } });
}

// The metadata as served: public and the same for everyone, so browser-based
// MCP clients may read it too
export function protectedResourceMetadataResponse(request: Request): Response {
  return Response.json(protectedResourceMetadata(request), { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" } });
}
