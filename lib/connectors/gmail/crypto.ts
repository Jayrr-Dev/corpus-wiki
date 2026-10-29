import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// =====================================================================
// TOKEN ENCRYPTION: Google tokens are sealed with AES-256-GCM before they
// reach the database, with a key only the server holds (GMAIL_TOKEN_KEY,
// 32 bytes as base64 or hex). The person's id is bound in as associated
// data, so one person's sealed tokens cannot be replayed as another's.
//   v1.<iv>.<tag>.<ciphertext>   (each part base64url)
// =====================================================================

const VERSION = "v1";
const IV_BYTES = 12;

// The 32-byte key from its env text; a clear error when it is missing or the wrong size
export function tokenKeyFrom(text: string | undefined): Buffer {
  const value = text?.trim();
  if (!value) throw new Error("Set GMAIL_TOKEN_KEY (32 random bytes, base64) on the server to store Gmail tokens.");
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("GMAIL_TOKEN_KEY must be 32 bytes (base64 or 64 hex characters).");
  return key;
}

export function sealTokens(key: Buffer, personId: string, value: unknown): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(personId, "utf8"));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function openTokens<T>(key: Buffer, personId: string, sealed: string): T {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || body === undefined) throw new Error("The stored Gmail tokens are not in a known format; connect again.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(personId, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  try {
    const text = Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
    return JSON.parse(text) as T;
  } catch {
    throw new Error("The stored Gmail tokens could not be read (was GMAIL_TOKEN_KEY changed?); connect again.");
  }
}
