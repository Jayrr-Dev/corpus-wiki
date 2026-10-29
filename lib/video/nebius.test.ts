import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NEBIUS_TOKEN_URL, nebiusTokenSource, serviceAccountKeyFromEnv, signServiceAccountJwt } from "./nebius";

// A throwaway key pair; nothing here reaches Nebius
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const key = { serviceAccountId: "serviceaccount-1", publicKeyId: "publickey-1", privateKey };
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

// A token endpoint that answers each exchange with a new token, recording the forms it got
function fakeTokenEndpoint(answer: (index: number) => { status?: number; body: unknown } = (index) => ({ body: { access_token: `token-${index + 1}`, expires_in: 43200, token_type: "Bearer" } })) {
  const calls: { url: string; form: URLSearchParams }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), form: new URLSearchParams(String(init?.body)) });
    const { status, body } = answer(calls.length - 1);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: status ?? 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("Nebius service account tokens", () => {
  it("signs an RS256 JWT with the key id, the service account as issuer and subject, for five minutes", () => {
    const jwt = signServiceAccountJwt(key, 1_000_000_000);
    const [header, claims, signature] = jwt.split(".");
    expect(decode(header!)).toEqual({ alg: "RS256", typ: "JWT", kid: "publickey-1" });
    expect(decode(claims!)).toEqual({ iss: "serviceaccount-1", sub: "serviceaccount-1", iat: 1_000_000, exp: 1_000_300 });
    expect(createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature!, "base64url"))).toBe(true);
  });

  it("exchanges the JWT for an access token (RFC 8693) and reuses it until near expiry", async () => {
    let now = 1_000_000_000;
    const { fetch, calls } = fakeTokenEndpoint();
    const token = nebiusTokenSource(key, { fetch, now: () => now });
    expect(await token()).toBe("token-1");
    expect(calls[0]!.url).toBe(NEBIUS_TOKEN_URL);
    const form = Object.fromEntries(calls[0]!.form);
    expect(form).toMatchObject({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    });
    expect(decode(form.subject_token!.split(".")[1]!).sub).toBe("serviceaccount-1");
    now += 10 * 3600_000;
    expect(await token()).toBe("token-1");
    // within the hour before the 12-hour token lapses, a new one is minted
    now += 1.5 * 3600_000;
    expect(await token()).toBe("token-2");
    expect(calls).toHaveLength(2);
  });

  it("shares one exchange between concurrent callers", async () => {
    const { fetch, calls } = fakeTokenEndpoint();
    const token = nebiusTokenSource(key, { fetch });
    expect(await Promise.all([token(), token(), token()])).toEqual(["token-1", "token-1", "token-1"]);
    expect(calls).toHaveLength(1);
  });

  it("says why when the exchange fails, and tries again next time", async () => {
    const { fetch, calls } = fakeTokenEndpoint((index) => (index === 0 ? { status: 401, body: { error: "invalid_grant" } } : { body: { access_token: "token-2", expires_in: 43200 } }));
    const token = nebiusTokenSource(key, { fetch });
    await expect(token()).rejects.toThrow("(401)");
    expect(await token()).toBe("token-2");
    expect(calls).toHaveLength(2);
    await expect(nebiusTokenSource(key, { fetch: fakeTokenEndpoint(() => ({ body: {} })).fetch })()).rejects.toThrow("no access token");
  });

  it("reads the key from a file or inline PEM, naming whatever is missing", () => {
    const ids = { NEBIUS_SERVICE_ACCOUNT_ID: "serviceaccount-1", NEBIUS_PUBLIC_KEY_ID: "publickey-1" };
    expect(serviceAccountKeyFromEnv({ ...ids, NEBIUS_PRIVATE_KEY_PATH: "/keys/private.pem" }, (path) => `pem from ${path}`)).toEqual({ ...key, privateKey: "pem from /keys/private.pem" });
    expect(serviceAccountKeyFromEnv({ ...ids, NEBIUS_PRIVATE_KEY: "-----BEGIN\\nabc\\n-----END" }).privateKey).toBe("-----BEGIN\nabc\n-----END");
    expect(() => serviceAccountKeyFromEnv({})).toThrow("NEBIUS_SERVICE_ACCOUNT_ID, NEBIUS_PUBLIC_KEY_ID, NEBIUS_PRIVATE_KEY_PATH or NEBIUS_PRIVATE_KEY");
    expect(() => serviceAccountKeyFromEnv({ ...ids, NEBIUS_PRIVATE_KEY_PATH: "/missing.pem" }, () => {
      throw new Error("ENOENT");
    })).toThrow("NEBIUS_PRIVATE_KEY_PATH");
  });
});
