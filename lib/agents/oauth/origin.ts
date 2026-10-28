// =====================================================================
// WHERE THE AUTHORIZATION SERVER LIVES. The issuer is the app's origin
// and tokens are bound to the MCP URL (RFC 8707), built the same way as
// the MCP route's resource (app/api/mcp/resource.ts): APP_ORIGIN when set
// (behind a proxy that rewrites the host), else the request's own origin.
// =====================================================================

export const MCP_PATH = "/api/mcp";

// The app's public origin
export function appOrigin(request: Request): string {
  const configured = process.env.APP_ORIGIN?.trim();
  return configured ? new URL(configured).origin : new URL(request.url).origin;
}

// The canonical MCP server URL: the resource every token is issued for
export function mcpResourceUrl(request: Request): string {
  return `${appOrigin(request)}${MCP_PATH}`;
}

// A resource parameter names this server when it equals the MCP URL, ignoring a trailing slash
export function isOurResource(resource: string, request: Request): boolean {
  return resource.replace(/\/+$/, "") === mcpResourceUrl(request);
}
