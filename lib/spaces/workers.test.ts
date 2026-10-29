import { afterEach, expect, it, vi } from "vitest";
import { currentActor, withSpaceActor } from "@/lib/auth/currentPerson";
import { databaseBackoff } from "@/lib/db/backoff";
import { forEachWorkerSpace } from "./workers";

const listSpaces = vi.fn(async () => ["space-a", "space-b"]);
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => ({}) }));
vi.mock("@/lib/db/rpc", () => ({ supabaseRpc: () => ({ call: () => listSpaces() }) }));

afterEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  databaseBackoff.succeeded();
  vi.restoreAllMocks();
  listSpaces.mockClear();
});

it("pauses every worker after the database times out and resumes once a pass succeeds", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.useFakeTimers();
  try {
    const visited: string[] = [];
    await forEachWorkerSpace(async () => {
      const { spaceId } = await currentActor();
      visited.push(spaceId!);
      throw new Error("claim_suggestion_work: canceling statement due to statement timeout");
    });
    expect(visited).toEqual(["space-a"]); // Later spaces are skipped once the database is struggling
    expect(databaseBackoff.paused()).toBe(true);

    expect(await forEachWorkerSpace(async () => "ran")).toEqual([]);
    expect(listSpaces).toHaveBeenCalledOnce(); // The paused pass never reached the database

    vi.advanceTimersByTime(15_000);
    expect(await forEachWorkerSpace(async () => "ran")).toEqual(["ran", "ran"]);
    expect(databaseBackoff.paused()).toBe(false);
    expect(warning).toHaveBeenCalledTimes(2); // The pause notice and the failed task
  } finally { vi.useRealTimers(); }
});

it("pauses when the space list itself cannot be read", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  listSpaces.mockRejectedValueOnce(new Error("fetch failed"));
  await expect(forEachWorkerSpace(async () => "ran")).rejects.toThrow("fetch failed");
  expect(databaseBackoff.paused()).toBe(true);
});

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
