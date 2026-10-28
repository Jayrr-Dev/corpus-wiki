import { preflight } from "@/lib/agents/oauth/http";
import { handleRevokeRequest } from "@/lib/agents/oauth/tokenEndpoint";

// OAUTH TOKEN REVOCATION (RFC 7009)
export const POST = handleRevokeRequest;
export const OPTIONS = preflight;
