import "server-only";

import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { isAgentScope, type AgentScope } from "@/lib/agents/scopes";
import { ACCESS_TOKEN_PREFIX, CODE_PREFIX, REFRESH_TOKEN_PREFIX, hashSecret, newSecret } from "./secrets";

// =====================================================================
// OAUTH TOKEN STORE: the one place server code reaches the OAuth tables,
// always through their server-only functions
// (supabase/migrations/20261119030500_agent_auth.sql). Plain codes and
// tokens leave here once, in the answer to the client; only hashes go in.
// =====================================================================

export const ACCESS_TOKEN_SECONDS = 60 * 60;
export const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;

export type OAuthClient = {
  client_id: string;
  name: string;
  redirect_uris: string[];
  kind: "cimd" | "dcr";
  metadata: Record<string, unknown>;
  fetched_at: string | null;
  created_at: string;
};

// RFC 6749 section 5.2 error codes (and invalid_target from RFC 8707)
export type TokenErrorCode = "invalid_request" | "invalid_client" | "invalid_grant" | "unauthorized_client" | "unsupported_grant_type" | "invalid_scope" | "invalid_target";
export type TokenError = { error: TokenErrorCode; error_description: string };

// What the token endpoint sends back on success (RFC 6749 section 5.1)
export type TokenSet = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

const db = () => supabaseRpc(getAdminSupabase());

// A client by id, or null
export async function getClient(clientId: string): Promise<OAuthClient | null> {
  return db().call<OAuthClient | null>("oauth_get_client", { p_client_id: clientId });
}

// Saves a registered (dcr) or fetched (cimd) client
export async function saveClient(client: Pick<OAuthClient, "client_id" | "name" | "redirect_uris" | "kind" | "metadata">): Promise<OAuthClient> {
  return db().call<OAuthClient>("oauth_save_client", {
    p_client_id: client.client_id,
    p_name: client.name,
    p_redirect_uris: client.redirect_uris,
    p_kind: client.kind,
    p_metadata: client.metadata,
  });
}

// CONSENT: records the signed-in person's grant and returns a one-time code (10 minutes).
// Runs as the person the admin client names, so call it only from a person's request.
export async function issueCode(input: {
  clientId: string; spaceId: string | null; scopes: AgentScope[];
  redirectUri: string; codeChallenge: string; resource: string;
}): Promise<string> {
  const code = newSecret(CODE_PREFIX);
  await db().call<string>("oauth_authorize", {
    p_client_id: input.clientId,
    p_space: input.spaceId,
    p_scopes: input.scopes,
    p_code_hash: hashSecret(code),
    p_redirect_uri: input.redirectUri,
    p_code_challenge: input.codeChallenge,
    p_resource: input.resource,
  });
  return code;
}

type IssueAnswer = { error: TokenErrorCode; error_description: string } | { scopes: string[]; resource: string };

// Turns the database's answer into a token set, or an RFC 6749 error
function toTokenSet(answer: IssueAnswer, access: string, refresh: string): TokenSet | TokenError {
  if ("error" in answer) return { error: answer.error, error_description: answer.error_description };
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_SECONDS,
    refresh_token: refresh,
    scope: answer.scopes.filter(isAgentScope).join(" "),
  };
}

// AUTHORIZATION CODE GRANT: `challenge` is the S256 of the client's code_verifier
export async function exchangeCode(input: {
  code: string; clientId: string; redirectUri: string; challenge: string; resource: string | null;
}): Promise<TokenSet | TokenError> {
  const access = newSecret(ACCESS_TOKEN_PREFIX);
  const refresh = newSecret(REFRESH_TOKEN_PREFIX);
  const answer = await db().call<IssueAnswer>("oauth_exchange_code", {
    p_code_hash: hashSecret(input.code),
    p_client_id: input.clientId,
    p_redirect_uri: input.redirectUri,
    p_challenge: input.challenge,
    p_resource: input.resource,
    p_access_hash: hashSecret(access),
    p_refresh_hash: hashSecret(refresh),
    p_access_seconds: ACCESS_TOKEN_SECONDS,
    p_refresh_seconds: REFRESH_TOKEN_SECONDS,
  });
  return toTokenSet(answer, access, refresh);
}

// REFRESH TOKEN GRANT: rotates the refresh token; `scopes` may only narrow
export async function refreshTokens(input: {
  refreshToken: string; clientId: string; resource: string | null; scopes: string[] | null;
}): Promise<TokenSet | TokenError> {
  const access = newSecret(ACCESS_TOKEN_PREFIX);
  const refresh = newSecret(REFRESH_TOKEN_PREFIX);
  const answer = await db().call<IssueAnswer>("oauth_refresh", {
    p_refresh_hash: hashSecret(input.refreshToken),
    p_client_id: input.clientId,
    p_resource: input.resource,
    p_scopes: input.scopes,
    p_access_hash: hashSecret(access),
    p_new_refresh_hash: hashSecret(refresh),
    p_access_seconds: ACCESS_TOKEN_SECONDS,
    p_refresh_seconds: REFRESH_TOKEN_SECONDS,
  });
  return toTokenSet(answer, access, refresh);
}

// RFC 7009: revokes an access token, or a refresh token and its family; unknown tokens are ignored
export async function revokeToken(token: string, clientId: string | null): Promise<void> {
  await db().call("oauth_revoke_token", { p_token_hash: hashSecret(token), p_client_id: clientId });
}
