import "server-only";
import { createHash } from "node:crypto";
import type { DbRpc } from "@/lib/db/rpc";

export interface ComposerCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}
// Database JSON and schema parsing can reorder object fields. Field order must
// not turn an identical image/context into a cache miss; array order still matters.
export const cacheKey = (kind: string, value: unknown) => `${kind}:v2:${createHash("sha256").update(JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest("hex")}`;
export const imageDigest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export function persistentComposerCache(db: DbRpc): ComposerCache {
  return {
    async get(key) { try { return await db.call("read_composer_cache", { p_key: key }); } catch { return null; } },
    async set(key, value, ttlSeconds) { try { await db.call("write_composer_cache", { p_key: key, p_value: value, p_ttl_seconds: ttlSeconds }); } catch { /* Cache failures must not block illustration. */ } },
  };
}
