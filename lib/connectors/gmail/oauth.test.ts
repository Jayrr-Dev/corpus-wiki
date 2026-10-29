import { describe, expect, it, vi } from "vitest";
import { openTokens, sealTokens, tokenKeyFrom } from "./crypto";
import { GMAIL_READONLY_SCOPE, authorizationUrl, checkGrantedScope, exchangeCode, newAuthAttempt, refreshTokens, tokensFresh } from "./oauth";

const client = { clientId: "client-1", clientSecret: "secret-1", redirectUri: "http://localhost:3000/api/gmail/callback" };
const KEY = tokenKeyFrom(Buffer.alloc(32, 7).toString("base64"));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("authorization URL", () => {
  it("asks for gmail.readonly and nothing else", () => {
    const url = new URL(authorizationUrl(client, newAuthAttempt()));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(GMAIL_READONLY_SCOPE);
    expect(GMAIL_READONLY_SCOPE).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    // The secret never goes into a URL the browser sees
    expect(url.toString()).not.toContain("secret-1");
  });
});

describe("granted scope", () => {
  it("accepts read-only Gmail alone", () => {
    expect(() => checkGrantedScope(GMAIL_READONLY_SCOPE)).not.toThrow();
  });
  it("refuses a grant without it or with more", () => {
    expect(() => checkGrantedScope("")).toThrow(/read access/);
    expect(() => checkGrantedScope(`${GMAIL_READONLY_SCOPE} https://www.googleapis.com/auth/gmail.send`)).toThrow(/more than read-only/);
  });
});

describe("token exchange", () => {
  it("turns the code into tokens with the PKCE verifier", async () => {
    const fetch = vi.fn(async () => json({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: GMAIL_READONLY_SCOPE }));
    const tokens = await exchangeCode(fetch, client, "code-1", "verifier-1", 1_000);
    expect(tokens).toEqual({ accessToken: "at", refreshToken: "rt", expiresAt: 1_000 + 3_600_000 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("code_verifier")).toBe("verifier-1");
    expect(form.get("grant_type")).toBe("authorization_code");
  });

  it("needs a refresh token", async () => {
    const fetch = vi.fn(async () => json({ access_token: "at", scope: GMAIL_READONLY_SCOPE }));
    await expect(exchangeCode(fetch, client, "c", "v")).rejects.toThrow(/refresh token/);
  });

  it("passes Google's refusal on", async () => {
    const fetch = vi.fn(async () => json({ error: "invalid_grant", error_description: "Bad code" }, 400));
    await expect(exchangeCode(fetch, client, "c", "v")).rejects.toThrow("Bad code");
  });

  it("refreshes and keeps the refresh token when Google sends none", async () => {
    const fetch = vi.fn(async () => json({ access_token: "at-2", expires_in: 60 }));
    const tokens = await refreshTokens(fetch, client, { accessToken: "at", refreshToken: "rt", expiresAt: 0 }, 5);
    expect(tokens).toEqual({ accessToken: "at-2", refreshToken: "rt", expiresAt: 5 + 60_000 });
    expect(tokensFresh(tokens, 5)).toBe(false);
    expect(tokensFresh({ ...tokens, expiresAt: 10 * 60_000 }, 0)).toBe(true);
  });
});

describe("token sealing", () => {
  it("round-trips and never stores the tokens in the clear", () => {
    const sealed = sealTokens(KEY, "person-1", { refreshToken: "rt-secret" });
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("rt-secret");
    expect(openTokens(KEY, "person-1", sealed)).toEqual({ refreshToken: "rt-secret" });
  });

  it("cannot be opened for another person or with another key", () => {
    const sealed = sealTokens(KEY, "person-1", { refreshToken: "rt" });
    expect(() => openTokens(KEY, "person-2", sealed)).toThrow(/could not be read/);
    expect(() => openTokens(tokenKeyFrom("ab".repeat(32)), "person-1", sealed)).toThrow(/could not be read/);
  });

  it("needs a 32-byte key", () => {
    expect(() => tokenKeyFrom(undefined)).toThrow(/GMAIL_TOKEN_KEY/);
    expect(() => tokenKeyFrom(Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
