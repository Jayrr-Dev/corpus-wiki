import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { type FeatureFlagKey, type FeatureFlags, defaultFeatureFlags } from "./registry";
import { readFeatureFlags } from "./store";

// =====================================================================
// FEATURE FLAGS ON THE SERVER: pages, layouts, route handlers and server
// actions ask here. Read once per request.
// =====================================================================

// Every flag; throws when the database cannot be read (Settings shows the error)
export const getFeatureFlags = cache(async (): Promise<FeatureFlags> => readFeatureFlags(supabaseRpc(getAdminSupabase())));

// Every flag, or every flag off when the database cannot be read (a gate fails closed)
export async function getFeatureFlagsOrDefaults(): Promise<FeatureFlags> {
  try {
    return await getFeatureFlags();
  } catch (error) {
    console.error("Feature flags could not be read; every flag is treated as off.", error);
    return defaultFeatureFlags();
  }
}

// True only when the flag is on; off when it is unset or cannot be read
export async function isFeatureEnabled(key: FeatureFlagKey): Promise<boolean> {
  return (await getFeatureFlagsOrDefaults())[key] === true;
}

// Gate for a page, route handler or server action behind a flag: a 404 while it is off
export async function requireFeature(key: FeatureFlagKey): Promise<void> {
  if (!(await isFeatureEnabled(key))) notFound();
}
