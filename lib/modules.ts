import "server-only";

import { notFound } from "next/navigation";
import { type DbRpc, supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";

// =====================================================================
// MODULES: Study, Video and Docs (docs/knowledge-modules-plan.md). Each
// sits behind its own switch in Settings → Features, off by default. The
// switches live in workspace_settings.modules ({"study": true}); turning
// one off hides its nav item and routes but keeps its data.
// =====================================================================

// Keep in step with set_module_enabled in the database
export const MODULE_KEYS = ["study", "video", "docs"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

// What get_workspace_settings returns for the switches; older databases have no `modules`
export type ModuleSettings = { modules?: Record<string, unknown> | null };

export const isModuleKey = (value: unknown): value is ModuleKey => (MODULE_KEYS as readonly unknown[]).includes(value);

// True only when the switch is on: a missing key, a missing `modules` or anything but `true` is off
export function isModuleEnabled(settings: ModuleSettings | null | undefined, key: ModuleKey): boolean {
  return settings?.modules?.[key] === true;
}

// The modules that are on, in nav order
export function enabledModules(settings: ModuleSettings | null | undefined): ModuleKey[] {
  return MODULE_KEYS.filter((key) => isModuleEnabled(settings, key));
}

const adminDb = (): DbRpc => supabaseRpc(getAdminSupabase());

// The modules that are on for the current space
export async function readEnabledModules(db: DbRpc = adminDb()): Promise<ModuleKey[]> {
  return enabledModules(await db.call<ModuleSettings>("get_workspace_settings"));
}

// Turns one module on or off for the current space; its data stays either way
export async function setModuleEnabled(key: ModuleKey, on: boolean, db: DbRpc = adminDb()): Promise<void> {
  if (!isModuleKey(key)) throw new Error(`Unknown module "${String(key)}".`);
  await db.call("set_module_enabled", { p_module: key, p_enabled: on });
}

// PAGE GUARD: a module's pages call this first, so they 404 while the module is off
export async function requireModule(key: ModuleKey, db?: DbRpc): Promise<void> {
  if (!(await readEnabledModules(db)).includes(key)) notFound();
}

// ROUTE GUARD: a module's API routes return this 404 while the module is off (null when it is on)
export async function moduleOffResponse(key: ModuleKey, db?: DbRpc): Promise<Response | null> {
  if ((await readEnabledModules(db)).includes(key)) return null;
  return Response.json({ error: "Not found." }, { status: 404 });
}
