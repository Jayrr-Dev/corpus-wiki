import { protectedResourceMetadataResponse } from "@/app/api/mcp/resource";

// PROTECTED RESOURCE METADATA (RFC 9728) at the root well-known path, for
// clients that look here before the path-suffixed one (/api/mcp below)
export function GET(request: Request): Response {
  return protectedResourceMetadataResponse(request);
}
