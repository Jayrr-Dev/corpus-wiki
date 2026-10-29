import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

// =====================================================================
// NEBIUS IAM TOKENS from the `video-render` service account's authorized
// key, so render jobs need neither the `nebius` CLI (no Windows build, not
// on Vercel) nor a static token (they expire after about 12 hours).
// Sign a short JWT with the private key (RS256, kid = the key's ID,
// iss = sub = the service account), exchange it at the token endpoint
// (RFC 8693), and reuse the access token until it nears expiry.
// https://docs.nebius.com/rest-api/authentication
// Server env:
//   NEBIUS_SERVICE_ACCOUNT_ID  the service account (serviceaccount-…)
//   NEBIUS_PUBLIC_KEY_ID       its authorized key (publickey-…)
//   NEBIUS_PRIVATE_KEY_PATH    the key's private PEM file, or
//   NEBIUS_PRIVATE_KEY         the PEM itself, for hosted deploys (\n escapes are fine)
// =====================================================================

export const NEBIUS_TOKEN_URL = "https://auth.eu.nebius.com/oauth2/token/exchange";

export type ServiceAccountKey = { serviceAccountId: string; publicKeyId: string; privateKey: string };

export class NebiusAuthError extends Error {}

// The key from server env; a missing piece is named in the error
export function serviceAccountKeyFromEnv(env: Record<string, string | undefined>, readFile: (path: string) => string = (path) => readFileSync(path, "utf8")): ServiceAccountKey {
  const serviceAccountId = env.NEBIUS_SERVICE_ACCOUNT_ID?.trim();
  const publicKeyId = env.NEBIUS_PUBLIC_KEY_ID?.trim();
  const inline = env.NEBIUS_PRIVATE_KEY?.trim();
  const path = env.NEBIUS_PRIVATE_KEY_PATH?.trim();
  const missing = [!serviceAccountId && "NEBIUS_SERVICE_ACCOUNT_ID", !publicKeyId && "NEBIUS_PUBLIC_KEY_ID", !inline && !path && "NEBIUS_PRIVATE_KEY_PATH or NEBIUS_PRIVATE_KEY"].filter(Boolean);
  if (missing.length) throw new NebiusAuthError(`Add ${missing.join(", ")} to the server environment to render videos.`);
  let privateKey: string;
  if (inline) privateKey = inline.replace(/\\n/g, "\n");
  else {
    try {
      privateKey = readFile(path!);
    } catch {
      throw new NebiusAuthError(`Could not read the Nebius private key at NEBIUS_PRIVATE_KEY_PATH (${path}).`);
    }
  }
  return { serviceAccountId: serviceAccountId!, publicKeyId: publicKeyId!, privateKey };
}

const encode = (value: string | Buffer) => Buffer.from(value).toString("base64url");

// The JWT the token endpoint takes in exchange; it lives five minutes, as in the docs
export function signServiceAccountJwt(key: ServiceAccountKey, nowMs: number): string {
  const now = Math.floor(nowMs / 1000);
  const body = `${encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: key.publicKeyId }))}.${encode(JSON.stringify({ iss: key.serviceAccountId, sub: key.serviceAccountId, iat: now, exp: now + 300 }))}`;
  return `${body}.${createSign("RSA-SHA256").update(body).sign(key.privateKey).toString("base64url")}`;
}

export type TokenSource = () => Promise<string>;

export type TokenSourceOptions = {
  fetch?: typeof fetch;
  now?: () => number;
  url?: string;
  // a token is replaced this long before it expires, so a job never starts (or pulls its image) with one about to lapse
  refreshMarginMs?: number;
};

// Mints access tokens on demand and keeps the last one until refreshMarginMs before it expires;
// concurrent callers share one exchange
export function nebiusTokenSource(key: ServiceAccountKey, options: TokenSourceOptions = {}): TokenSource {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const margin = options.refreshMarginMs ?? 60 * 60_000;
  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;

  const exchange = async () => {
    const issuedAt = now();
    const response = await doFetch(options.url ?? NEBIUS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        subject_token: signServiceAccountJwt(key, issuedAt),
        subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      }).toString(),
    });
    const text = await response.text();
    // the answer carries no secret when it fails, only the reason
    if (!response.ok) throw new NebiusAuthError(`Nebius refused the service account key (${response.status}): ${text.slice(0, 300)}`);
    let answer: { access_token?: unknown; expires_in?: unknown };
    try {
      answer = JSON.parse(text) as typeof answer;
    } catch {
      throw new NebiusAuthError("Nebius answered the token exchange with something other than JSON.");
    }
    if (typeof answer.access_token !== "string" || !answer.access_token) throw new NebiusAuthError("Nebius returned no access token.");
    const expiresIn = Number(answer.expires_in);
    cached = { token: answer.access_token, expiresAt: issuedAt + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 0) };
    return answer.access_token;
  };

  return async () => {
    if (cached && cached.expiresAt - margin > now()) return cached.token;
    pending ??= exchange().finally(() => {
      pending = null;
    });
    return pending;
  };
}
