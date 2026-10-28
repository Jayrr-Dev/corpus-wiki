import { AGENT_SCOPES } from "@/lib/agents/scopes";

// =====================================================================
// AUTHORIZATION SERVER METADATA (RFC 8414), served at
// /.well-known/oauth-authorization-server and the OpenID path. The
// issuer is the app's origin; MCP clients find it through the Protected
// Resource Metadata of /api/mcp.
// =====================================================================

// Clients may ask for offline_access; refresh tokens are issued either way
export const OFFLINE_ACCESS = "offline_access";

export function authorizationServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    scopes_supported: [...AGENT_SCOPES, OFFLINE_ACCESS],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}
