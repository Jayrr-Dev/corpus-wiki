import { describe, expect, it } from "vitest";
import { bearer, signCallbackToken, verifyCallbackToken } from "./token";

const SECRET = "test-secret";
const NOW = Date.parse("2026-10-29T10:00:00.000Z");
const claims = { videoId: "video-1", spaceId: "space-1", exp: NOW + 60_000 };

describe("render callback token", () => {
  it("verifies a token it signed", () => {
    expect(verifyCallbackToken(signCallbackToken(claims, SECRET), SECRET, "video-1", NOW)).toEqual({ ok: true, claims });
  });

  it("refuses a token signed with another secret", () => {
    expect(verifyCallbackToken(signCallbackToken(claims, "other"), SECRET, "video-1", NOW)).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses a token whose payload was changed", () => {
    const [, signature] = signCallbackToken(claims, SECRET).split(".");
    const forged = `${Buffer.from(JSON.stringify({ ...claims, videoId: "video-2" })).toString("base64url")}.${signature}`;
    expect(verifyCallbackToken(forged, SECRET, "video-2", NOW)).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses an expired token", () => {
    expect(verifyCallbackToken(signCallbackToken(claims, SECRET), SECRET, "video-1", claims.exp)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a token for another video", () => {
    expect(verifyCallbackToken(signCallbackToken(claims, SECRET), SECRET, "video-2", NOW)).toEqual({ ok: false, reason: "video" });
  });

  it("refuses missing and malformed tokens, and an empty secret", () => {
    expect(verifyCallbackToken(null, SECRET, "video-1", NOW).ok).toBe(false);
    expect(verifyCallbackToken("abc", SECRET, "video-1", NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyCallbackToken("a.b.c", SECRET, "video-1", NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyCallbackToken(signCallbackToken(claims, SECRET), "", "video-1", NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("will not sign without a secret", () => {
    expect(() => signCallbackToken(claims, "")).toThrow("VIDEO_CALLBACK_SECRET");
  });

  it("reads a bearer header", () => {
    expect(bearer("Bearer abc.def")).toBe("abc.def");
    expect(bearer("Basic abc")).toBeNull();
    expect(bearer(null)).toBeNull();
  });
});
