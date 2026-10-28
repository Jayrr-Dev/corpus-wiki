import { CORS_HEADERS, preflight } from "@/lib/agents/oauth/http";
import { authorizationServerMetadata } from "@/lib/agents/oauth/metadata";
import { appOrigin } from "@/lib/agents/oauth/origin";

// AUTHORIZATION SERVER METADATA (RFC 8414): how MCP clients find the sign-in endpoints
export function GET(request: Request): Response {
  return Response.json(authorizationServerMetadata(appOrigin(request)), { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" } });
}

export const OPTIONS = preflight;
