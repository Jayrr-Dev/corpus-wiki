import { beforeEach, expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import { forgetCachedMemory, memoryNotes, openRoleMemory, saveRoleMemory } from "./memory";

const actor = vi.hoisted(() => ({ spaceId: "space-a", personId: "owner", via: "app" }));
vi.mock("@/lib/auth/currentPerson", () => ({ currentActor: async () => actor }));
beforeEach(() => { actor.spaceId = "space-a"; forgetCachedMemory("deduplicator"); });

it("reviews outlines without saved or ambient reviewer memory", async () => {
  const db: DbRpc = { call: vi.fn() as DbRpc["call"] };
  expect(await openRoleMemory(db, "article_outline_review")).toBeNull();
  expect(db.call).not.toHaveBeenCalled();
});

it("keeps saved and ambient run notes isolated when one user switches spaces", async () => {
  const db: DbRpc = { call: vi.fn(async () => [{ key: "subject", value: actor.spaceId, source: null, updatedAt: "", expiresAt: null }]) as DbRpc["call"] };
  const first = (await openRoleMemory(db, "dedupe"))!;
  expect(first).not.toBeNull();
  await saveRoleMemory(first, [{ key: "private", value: "A only", scope: "run", ttlHours: 0 }], [], "test");
  actor.spaceId = "space-b";
  const second = (await openRoleMemory(db, "dedupe"))!;
  expect(memoryNotes(second)).toContain("space-b");
  expect(memoryNotes(second)).not.toContain("space-a");
  expect(memoryNotes(second)).not.toContain("A only");
  actor.spaceId = "space-a";
  const again = (await openRoleMemory(db, "dedupe"))!;
  expect(memoryNotes(again)).toContain("A only");
  expect(memoryNotes(again)).toContain("space-a");
  expect(db.call).toHaveBeenCalledTimes(2);
});
