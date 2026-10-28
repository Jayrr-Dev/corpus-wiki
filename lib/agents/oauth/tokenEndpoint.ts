import "server-only";

import { isAgentScope } from "@/lib/agents/scopes";
import { clientIdOf, oauthError, oauthJson, readForm } from "./http";
import { OFFLINE_ACCESS } from "./metadata";
import { appOrigin, isOurResource, mcpResourceUrl } from "./origin";
import { isCodeVerifier, pkceChallenge, ACCESS_TOKEN_PREFIX, REFRESH_TOKEN_PREFIX } from "./secrets";
import { exchangeCode, refreshTokens, revokeToken } from "./store";

// =====================================================================
// TOKEN AND REVOCATION ENDPOINTS (POST /oauth/token, POST /oauth/revoke).
// Public clients only: the client_id travels in the form, and PKCE
// proves the client that started the sign-in is the one finishing it.
// =====================================================================

// The resource a token request names, made canonical; undefined when it is not ours
function resourceOf(request: Request, form: Record<string, string>): string | null | undefined {
  if (!form.resource) return null;
  return isOurResource(form.resource, appOrigin(request)) ? mcpResourceUrl(request) : undefined;
}

// POST /oauth/token: authorization_code and refresh_token grants (RFC 6749, OAuth 2.1)
export async function handleTokenRequest(request: Request): Promise<Response> {
  const form = await readForm(request);
  if (typeof form === "string") return oauthError("invalid_request", form);
  const clientId = clientIdOf(request, form);
  if (!clientId) return oauthError("invalid_client", "client_id is required.");
  const resource = resourceOf(request, form);
  if (resource === undefined) return oauthError("invalid_target", "resource must be this server's MCP URL.");

  try {
    if (form.grant_type === "authorization_code") {
      if (!form.code) return oauthError("invalid_request", "code is required.");
      if (!form.redirect_uri) return oauthError("invalid_request", "redirect_uri is required.");
      if (!isCodeVerifier(form.code_verifier)) return oauthError("invalid_request", "A PKCE code_verifier of 43 to 128 characters is required.");
      const answer = await exchangeCode({
        code: form.code, clientId, redirectUri: form.redirect_uri, challenge: pkceChallenge(form.code_verifier), resource,
      });
      return "error" in answer ? oauthError(answer.error, answer.error_description) : oauthJson(answer);
    }
    if (form.grant_type === "refresh_token") {
      if (!form.refresh_token?.startsWith(REFRESH_TOKEN_PREFIX)) return oauthError("invalid_grant", "Unknown refresh token.");
      let scopes: string[] | null = null;
      if (form.scope) {
        const asked = form.scope.split(/\s+/).filter((scope) => scope && scope !== OFFLINE_ACCESS);
        if (asked.some((scope) => !isAgentScope(scope))) return oauthError("invalid_scope", "Unknown scope.");
        scopes = asked.length ? asked : null;
      }
      const answer = await refreshTokens({ refreshToken: form.refresh_token, clientId, resource, scopes });
      return "error" in answer ? oauthError(answer.error, answer.error_description) : oauthJson(answer);
    }
    return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
  } catch (error) {
    console.error("OAuth token request failed:", error);
    return oauthJson({ error: "server_error", error_description: "The token could not be issued. Try again." }, 500);
  }
}

// POST /oauth/revoke (RFC 7009): always 200 for a well-formed request,
// so a caller cannot learn whether a token existed
export async function handleRevokeRequest(request: Request): Promise<Response> {
  const form = await readForm(request);
  if (typeof form === "string") return oauthError("invalid_request", form);
  if (!form.token) return oauthError("invalid_request", "token is required.");
  if (form.token.startsWith(ACCESS_TOKEN_PREFIX) || form.token.startsWith(REFRESH_TOKEN_PREFIX)) {
    try {
      await revokeToken(form.token, clientIdOf(request, form));
    } catch (error) {
      console.error("OAuth revocation failed:", error);
      return oauthJson({ error: "server_error", error_description: "The token could not be revoked. Try again." }, 503);
    }
  }
  return oauthJson({});
}
