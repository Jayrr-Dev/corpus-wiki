import { expect, it, vi } from "vitest";
import { currentActor, withSpaceActor } from "@/lib/auth/currentPerson";
import { forEachWorkerSpace } from "./workers";

vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => ({}) }));
vi.mock("@/lib/db/rpc", () => ({ supabaseRpc: () => ({ call: async () => ["space-a", "space-b"] }) }));

it("does not inherit the request that started a timer and restores its caller's space", async () => {
  await withSpaceActor({ personId: "owner", via: "app", spaceId: "original" }, async () => {
    const actors = await forEachWorkerSpace(currentActor);
    expect(actors).toEqual([
      { personId: null, via: "script", spaceId: "space-a" },
      { personId: null, via: "script", spaceId: "space-b" },
    ]);
    expect((await currentActor()).spaceId).toBe("original");
  });
});

it("continues other spaces when a job in one space fails", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const results = await forEachWorkerSpace(async () => {
      const actor = await currentActor();
      if (actor.spaceId === "space-a") throw new Error("First job failed");
      return actor.spaceId;
    });
    expect(results).toEqual(["space-b"]);
    expect(warning).toHaveBeenCalledOnce();
  } finally { warning.mockRestore(); }
});
