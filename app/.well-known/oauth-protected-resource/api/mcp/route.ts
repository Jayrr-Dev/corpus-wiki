import { protectedResourceMetadataResponse } from "@/app/api/mcp/resource";

// PROTECTED RESOURCE METADATA (RFC 9728) for /api/mcp: the 401 from the
// MCP route points here, and it names the server that signs clients in
export function GET(request: Request): Response {
  return protectedResourceMetadataResponse(request);
}
