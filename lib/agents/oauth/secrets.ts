import { createHash, randomBytes } from "node:crypto";

// =====================================================================
// SECRETS: personal keys, authorization codes and tokens are random
// base64url strings with a prefix that says what they are. The database
// stores only their sha256 hash (supabase/migrations/20261119030500_agent_auth.sql).
// =====================================================================

export const PERSONAL_KEY_PREFIX = "cwk_";
export const ACCESS_TOKEN_PREFIX = "cwa_";
export const REFRESH_TOKEN_PREFIX = "cwr_";
export const CODE_PREFIX = "cwc_";

// A real secret is a prefix plus 43 base64url characters; anything far longer is not one
export const MAX_SECRET_LENGTH = 200;

// A new secret: the prefix plus 32 random bytes as base64url
export function newSecret(prefix: string): string {
  return prefix + randomBytes(32).toString("base64url");
}

// The hex sha256 the database stores for a secret
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

// PKCE S256 (RFC 7636): base64url(sha256(code_verifier))
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

// A code_verifier is 43 to 128 unreserved characters (RFC 7636 section 4.1)
export function isCodeVerifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9\-._~]{43,128}$/.test(value);
}

// An S256 code_challenge is a sha256 in base64url: 43 characters
export function isCodeChallenge(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9\-_]{43}$/.test(value);
}
