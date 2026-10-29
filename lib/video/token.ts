import { createHmac, timingSafeEqual } from "node:crypto";

// =====================================================================
// RENDER CALLBACK TOKEN: the render job calls back
// POST /api/video/[id]/rendered with this token, signed with
// VIDEO_CALLBACK_SECRET (HMAC-SHA256). It names the video, the space the
// callback writes to and when it stops working, so a token for one video
// can never finish another and an old one expires.
// Format: base64url(JSON payload) "." base64url(signature)
// =====================================================================

export type CallbackClaims = { videoId: string; spaceId: string; exp: number };

const encode = (value: string | Buffer) => Buffer.from(value).toString("base64url");
const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest();

export function signCallbackToken(claims: CallbackClaims, secret: string): string {
  if (!secret) throw new Error("Set VIDEO_CALLBACK_SECRET on the server.");
  const body = encode(JSON.stringify(claims));
  return `${body}.${encode(sign(body, secret))}`;
}

export type TokenCheck = { ok: true; claims: CallbackClaims } | { ok: false; reason: "malformed" | "signature" | "expired" | "video" };

// Checks the signature first, then the expiry and that the token is for this video
export function verifyCallbackToken(token: string | null | undefined, secret: string, videoId: string, now = Date.now()): TokenCheck {
  if (!secret || !token) return { ok: false, reason: "malformed" };
  const [body, signature, ...rest] = token.split(".");
  if (!body || !signature || rest.length) return { ok: false, reason: "malformed" };
  const expected = sign(body, secret);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "signature" };
  let claims: CallbackClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CallbackClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof claims?.videoId !== "string" || typeof claims.spaceId !== "string" || typeof claims.exp !== "number") return { ok: false, reason: "malformed" };
  if (claims.exp <= now) return { ok: false, reason: "expired" };
  if (claims.videoId !== videoId) return { ok: false, reason: "video" };
  return { ok: true, claims };
}

// The bearer token from an Authorization header
export function bearer(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return match?.[1] ?? null;
}
