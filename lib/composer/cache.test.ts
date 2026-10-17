import { expect, it, vi } from "vitest";
import { cacheKey, persistentComposerCache } from "./cache";
it("fails open when cache storage is unavailable", async () => {
  const cache = persistentComposerCache({ call: vi.fn().mockRejectedValue(new Error("offline")) });
  expect(await cache.get("key")).toBeNull();
  await expect(cache.set("key", { data: true }, 60)).resolves.toBeUndefined();
});
it("separates cache namespaces and changed inputs", () => {
  expect(cacheKey("search", "one")).not.toBe(cacheKey("candidate", "one"));
  expect(cacheKey("candidate", "one")).not.toBe(cacheKey("candidate", "two"));
});
it("ignores JSON field ordering across database round trips", () => {
  expect(cacheKey("candidate", { title: "Photo", metadata: { a: 1, b: 2 } })).toBe(cacheKey("candidate", { metadata: { b: 2, a: 1 }, title: "Photo" }));
  expect(cacheKey("candidate", [1, 2])).not.toBe(cacheKey("candidate", [2, 1]));
});
