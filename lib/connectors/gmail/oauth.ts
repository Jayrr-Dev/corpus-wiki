import { createHash, randomBytes } from "node:crypto";

// =====================================================================
// GOOGLE OAUTH FOR GMAIL IMPORT: the authorization-code flow with PKCE,
// asking for one scope only: gmail.readonly. Nothing here is sent to the
// browser except the Google sign-in URL; codes and tokens stay on the
// server. `fetch` is passed in so tests never call Google.
// =====================================================================

// THE ONLY SCOPE THIS APP ASKS FOR: read mail and labels, never send, change or delete
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export type GoogleClient = { clientId: string; clientSecret: string; redirectUri: string };

// What is sealed and stored per person
export type GmailTokens = { accessToken: string; refreshToken: string; expiresAt: number };

export type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

// A random state and PKCE verifier for one sign-in attempt
export function newAuthAttempt(): { state: string; verifier: string } {
  return { state: randomBytes(24).toString("base64url"), verifier: randomBytes(48).toString("base64url") };
}

function challengeOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// The Google consent URL: read-only Gmail, a refresh token (offline), no other granted scopes folded in
export function authorizationUrl(client: GoogleClient, attempt: { state: string; verifier: string }): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", client.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_READONLY_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", attempt.state);
  url.searchParams.set("code_challenge", challengeOf(attempt.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };

async function postForm(fetchImpl: Fetch, url: string, form: Record<string, string>): Promise<TokenResponse> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || body.error) throw new Error(`Google refused the request: ${body.error_description ?? body.error ?? response.status}`);
  return body;
}

// The granted scopes must include gmail.readonly and nothing broader than it
export function checkGrantedScope(scope: string | undefined): void {
  const granted = (scope ?? "").split(/\s+/).filter(Boolean);
  if (!granted.includes(GMAIL_READONLY_SCOPE)) throw new Error("Google did not grant read access to Gmail. Connect again and allow it.");
  const extra = granted.filter((item) => item !== GMAIL_READONLY_SCOPE);
  if (extra.length) throw new Error(`Google granted more than read-only Gmail access (${extra.join(", ")}); the connection was not saved.`);
}

// The one-time code becomes tokens; a refresh token is required, since imports run later
export async function exchangeCode(fetchImpl: Fetch, client: GoogleClient, code: string, verifier: string, now = Date.now()): Promise<GmailTokens> {
  const body = await postForm(fetchImpl, TOKEN_URL, {
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: client.redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  checkGrantedScope(body.scope);
  if (!body.access_token) throw new Error("Google sent no access token.");
  if (!body.refresh_token) throw new Error("Google sent no refresh token. Remove this app's access in your Google account, then connect again.");
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: now + (body.expires_in ?? 3600) * 1000 };
}

// A fresh access token from the refresh token (Google may also rotate the refresh token)
export async function refreshTokens(fetchImpl: Fetch, client: Omit<GoogleClient, "redirectUri">, tokens: GmailTokens, now = Date.now()): Promise<GmailTokens> {
  const body = await postForm(fetchImpl, TOKEN_URL, {
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: tokens.refreshToken,
    grant_type: "refresh_token",
  });
  if (body.scope) checkGrantedScope(body.scope);
  if (!body.access_token) throw new Error("Google sent no access token.");
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? tokens.refreshToken, expiresAt: now + (body.expires_in ?? 3600) * 1000 };
}

// Tokens still good for at least a minute
export function tokensFresh(tokens: GmailTokens, now = Date.now()): boolean {
  return tokens.expiresAt - 60_000 > now;
}

// Tells Google to end the grant; best effort (the stored tokens are deleted either way)
export async function revokeTokens(fetchImpl: Fetch, tokens: GmailTokens): Promise<boolean> {
  try {
    const response = await fetchImpl(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refreshToken }).toString(),
    });
    return response.ok;
  } catch {
    return false;
  }
}
