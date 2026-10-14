import { createHash, timingSafeEqual } from "node:crypto";

// =====================================================================
// API KEY CHECK for callers without a browser session (scripts, phone
// shortcuts, other agents). They send `Authorization: Bearer <key>`,
// where the key is SECOND_BRAIN_API_KEY from the server env.
// =====================================================================

// The bearer token in an Authorization header, or null when there is none
export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? "");
  return match?.[1]?.trim() || null;
}

// True when the token equals the key; hashing both first keeps the compare constant-time
export function apiKeyMatches(token: string, key: string | undefined): boolean {
  if (!key) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(token), digest(key));
}
