import { describe, expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";

const notFound = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => { throw new Error("tests pass their own database"); } }));

const { enabledModules, isModuleKey, moduleOffResponse, readEnabledModules, requireModule } = await import("./modules");

// A database whose get_feature_flags returns `saved`, recording every call
function fakeDb(saved: unknown) {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const db: DbRpc = { async call<T>(fn: string, args?: Record<string, unknown>) { calls.push({ fn, args }); return saved as T; } };
  return { db, calls };
}

// A database that cannot be read
const brokenDb: DbRpc = { async call() { throw new Error("connection lost"); } };

describe("enabledModules", () => {
  it("is empty by default", () => {
    expect(enabledModules({})).toEqual([]);
    expect(enabledModules(null)).toEqual([]);
    expect(enabledModules(undefined)).toEqual([]);
  });

  it("lists the modules that are on in nav order and ignores other flags", () => {
    expect(enabledModules({ docs: true, study: true, billing: true, video: false })).toEqual(["study", "docs"]);
  });

  it("knows only study, video and docs", () => {
    expect(["study", "video", "docs"].every(isModuleKey)).toBe(true);
    expect(isModuleKey("billing")).toBe(false);
    expect(isModuleKey(undefined)).toBe(false);
  });
});

describe("module flags in the database", () => {
  it("reads the modules from the feature flags", async () => {
    const { db, calls } = fakeDb({ video: true, billing: true });
    expect(await readEnabledModules(db)).toEqual(["video"]);
    expect(calls).toEqual([{ fn: "get_feature_flags", args: undefined }]);
  });

  it("treats anything but true as off", async () => {
    expect(await readEnabledModules(fakeDb({ study: "true", docs: 1, video: null }).db)).toEqual([]);
  });
});

describe("module guards", () => {
  it("404s a page while its module is off and lets it render when on", async () => {
    notFound.mockClear();
    await expect(requireModule("study", fakeDb({}).db)).rejects.toThrow(/404/);
    expect(notFound).toHaveBeenCalledTimes(1);
    await expect(requireModule("study", fakeDb({ study: true }).db)).resolves.toBeUndefined();
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("answers an API route with 404 while its module is off", async () => {
    const off = await moduleOffResponse("video", fakeDb({ study: true }).db);
    expect(off?.status).toBe(404);
    expect(await moduleOffResponse("video", fakeDb({ video: true }).db)).toBeNull();
  });

  it("fails closed when the flags cannot be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await moduleOffResponse("docs", brokenDb))?.status).toBe(404);
      await expect(requireModule("docs", brokenDb)).rejects.toThrow(/404/);
    } finally { error.mockRestore(); }
  });
});
