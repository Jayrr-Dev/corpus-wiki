import "server-only";

import { isAgentScope, type AgentScope } from "@/lib/agents/scopes";
import { ClientError, resolveClient } from "./clients";
import { isOurResource, resourceForOrigin } from "./origin";
import { clientRedirect, isLoopbackUri, redirectUriMatches } from "./redirects";
import { isCodeChallenge } from "./secrets";
import type { OAuthClient } from "./store";

// =====================================================================
// THE AUTHORIZATION REQUEST (GET /oauth/authorize). Checked twice: when
// the consent page opens and again when the person answers it, from the
// same query string. Until the client and its redirect URI are known,
// problems are shown to the person and never redirected (an open
// redirect); after that they go back to the client as RFC 6749 errors.
// =====================================================================

export type AuthorizeRequest = {
  client: OAuthClient;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  // The canonical MCP URL the tokens will be bound to
  resource: string;
  requestedScopes: AgentScope[];
  // Every registered redirect URI is on the person's own computer
  loopbackOnly: boolean;
};

export type ParsedAuthorize =
  | { kind: "ok"; request: AuthorizeRequest }
  | { kind: "show"; message: string }
  | { kind: "redirect"; url: string };

const PARAMS = ["response_type", "client_id", "redirect_uri", "scope", "state", "code_challenge", "code_challenge_method", "resource"];

// The redirect that answers the client with an error (RFC 6749 4.1.2.1, RFC 9207 iss)
export function errorRedirect(redirectUri: string, issuer: string, state: string | null, error: string, description: string): string {
  return clientRedirect(redirectUri, { error, error_description: description, state, iss: issuer });
}

// The agent scopes a scope parameter asks for; others (offline_access, unknown) are ignored
export function requestedScopesOf(scope: string | null): AgentScope[] {
  const asked = (scope ?? "").split(/\s+/).filter(isAgentScope);
  return [...new Set(asked)];
}

export async function parseAuthorizeRequest(query: URLSearchParams, issuer: string): Promise<ParsedAuthorize> {
  for (const name of PARAMS) {
    if (query.getAll(name).length > 1) return { kind: "show", message: `The ${name} parameter appears more than once.` };
  }
  const clientId = query.get("client_id");
  if (!clientId) return { kind: "show", message: "The request names no client (client_id is missing)." };
  let client: OAuthClient;
  try {
    client = await resolveClient(clientId);
  } catch (error) {
    if (error instanceof ClientError) return { kind: "show", message: error.message };
    throw error;
  }
  const asked = query.get("redirect_uri");
  // OAuth 2.1: the redirect_uri may be left out only when the client registered exactly one
  const redirectUri = asked ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0]! : null);
  if (!redirectUri) return { kind: "show", message: "The request names no redirect_uri." };
  if (!redirectUriMatches(client.redirect_uris, redirectUri)) {
    return { kind: "show", message: "The redirect_uri is not one this client registered." };
  }

  const state = query.get("state");
  const fail = (error: string, description: string): ParsedAuthorize => ({ kind: "redirect", url: errorRedirect(redirectUri, issuer, state, error, description) });
  if (query.get("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  const codeChallenge = query.get("code_challenge");
  if (!isCodeChallenge(codeChallenge) || query.get("code_challenge_method") !== "S256") {
    return fail("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  }
  const resource = query.get("resource");
  if (resource !== null && !isOurResource(resource, issuer)) {
    return fail("invalid_target", "resource must be this server's MCP URL.");
  }
  return {
    kind: "ok",
    request: {
      client,
      redirectUri,
      state,
      codeChallenge,
      resource: resourceForOrigin(issuer),
      requestedScopes: requestedScopesOf(query.get("scope")),
      loopbackOnly: client.redirect_uris.every(isLoopbackUri),
    },
  };
}
