import { describe, expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";

const notFound = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => { throw new Error("tests pass their own database"); } }));

const { enabledModules, isModuleEnabled, isModuleKey, moduleOffResponse, readEnabledModules, requireModule, setModuleEnabled } = await import("./modules");

// A database whose get_workspace_settings returns `settings`, recording every call
function fakeDb(settings: unknown) {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const db: DbRpc = { async call<T>(fn: string, args?: Record<string, unknown>) { calls.push({ fn, args }); return settings as T; } };
  return { db, calls };
}

describe("isModuleEnabled", () => {
  it("is off by default", () => {
    expect(isModuleEnabled({}, "study")).toBe(false);
    expect(isModuleEnabled({ modules: {} }, "video")).toBe(false);
    expect(isModuleEnabled({ modules: null }, "docs")).toBe(false);
    expect(isModuleEnabled(null, "study")).toBe(false);
    expect(isModuleEnabled(undefined, "study")).toBe(false);
  });

  it("is on only for an explicit true", () => {
    expect(isModuleEnabled({ modules: { study: true } }, "study")).toBe(true);
    expect(isModuleEnabled({ modules: { study: true } }, "video")).toBe(false);
    expect(isModuleEnabled({ modules: { study: false } }, "study")).toBe(false);
    expect(isModuleEnabled({ modules: { study: "true" } }, "study")).toBe(false);
    expect(isModuleEnabled({ modules: { study: 1 } }, "study")).toBe(false);
  });

  it("lists the modules that are on in nav order and ignores unknown names", () => {
    expect(enabledModules({ modules: { docs: true, study: true, billing: true, video: false } })).toEqual(["study", "docs"]);
    expect(enabledModules({})).toEqual([]);
  });

  it("knows only study, video and docs", () => {
    expect(["study", "video", "docs"].every(isModuleKey)).toBe(true);
    expect(isModuleKey("billing")).toBe(false);
    expect(isModuleKey(undefined)).toBe(false);
  });
});

describe("module switches in the database", () => {
  it("reads the switches from the workspace settings", async () => {
    const { db, calls } = fakeDb({ modules: { video: true } });
    expect(await readEnabledModules(db)).toEqual(["video"]);
    expect(calls).toEqual([{ fn: "get_workspace_settings", args: undefined }]);
  });

  it("saves one switch through set_module_enabled", async () => {
    const { db, calls } = fakeDb({});
    await setModuleEnabled("docs", true, db);
    expect(calls).toEqual([{ fn: "set_module_enabled", args: { p_module: "docs", p_enabled: true } }]);
  });

  it("rejects an unknown module before calling the database", async () => {
    const { db, calls } = fakeDb({});
    await expect(setModuleEnabled("billing" as never, true, db)).rejects.toThrow(/Unknown module/);
    expect(calls).toEqual([]);
  });
});

describe("module guards", () => {
  it("404s a page while its module is off and lets it render when on", async () => {
    await expect(requireModule("study", fakeDb({ modules: {} }).db)).rejects.toThrow(/404/);
    expect(notFound).toHaveBeenCalledTimes(1);
    await expect(requireModule("study", fakeDb({ modules: { study: true } }).db)).resolves.toBeUndefined();
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("answers an API route with 404 while its module is off", async () => {
    const off = await moduleOffResponse("video", fakeDb({ modules: { study: true } }).db);
    expect(off?.status).toBe(404);
    expect(await moduleOffResponse("video", fakeDb({ modules: { video: true } }).db)).toBeNull();
  });
});
