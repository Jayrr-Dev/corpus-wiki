import "server-only";

import { notFound } from "next/navigation";
import { type DbRpc, supabaseRpc } from "@/lib/db/rpc";
import type { FeatureFlags } from "@/lib/flags/registry";
import { readFeatureFlags } from "@/lib/flags/store";
import { getAdminSupabase } from "@/lib/supabase/admin";

// =====================================================================
// MODULES: Study, Video and Docs (docs/knowledge-modules-plan.md). Each
// is an app-wide feature flag (lib/flags/registry.ts), off by default and
// listed in Settings → Features. Turning one off hides its nav item and
// routes but keeps its data.
// =====================================================================

export const MODULE_KEYS = ["study", "video", "docs"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const isModuleKey = (value: unknown): value is ModuleKey => (MODULE_KEYS as readonly unknown[]).includes(value);

// The modules that are on, in nav order; a flag that is unset or missing is off
export function enabledModules(flags: Partial<FeatureFlags> | null | undefined): ModuleKey[] {
  return MODULE_KEYS.filter((key) => flags?.[key] === true);
}

const adminDb = (): DbRpc => supabaseRpc(getAdminSupabase());

// The modules that are on; throws when the flags cannot be read
export async function readEnabledModules(db: DbRpc = adminDb()): Promise<ModuleKey[]> {
  return enabledModules(await readFeatureFlags(db));
}

// True while the module is on; off when the flags cannot be read (a gate fails closed)
async function moduleOn(key: ModuleKey, db?: DbRpc): Promise<boolean> {
  try {
    return (await readEnabledModules(db)).includes(key);
  } catch (error) {
    console.error(`Feature flags could not be read; ${key} is treated as off.`, error);
    return false;
  }
}

// PAGE GUARD: a module's pages call this first, so they 404 while the module is off
export async function requireModule(key: ModuleKey, db?: DbRpc): Promise<void> {
  if (!(await moduleOn(key, db))) notFound();
}

// ROUTE GUARD: a module's API routes return this 404 while the module is off (null when it is on)
export async function moduleOffResponse(key: ModuleKey, db?: DbRpc): Promise<Response | null> {
  if (await moduleOn(key, db)) return null;
  return Response.json({ error: "Not found." }, { status: 404 });
}
