import type { DbRpc } from "@/lib/db/rpc";
import { type FeatureFlagKey, type FeatureFlags, isFeatureFlagKey, resolveFeatureFlags } from "./registry";

// =====================================================================
// FEATURE FLAG STORE: reads and writes public.feature_flags through the
// database function port, so tests pass a fake DbRpc.
// =====================================================================

// Every registered flag, saved values over the defaults
export async function readFeatureFlags(db: DbRpc): Promise<FeatureFlags> {
  return resolveFeatureFlags(await db.call<unknown>("get_feature_flags"));
}

// Turns one registered flag on or off and returns every flag after the change
export async function saveFeatureFlag(db: DbRpc, key: FeatureFlagKey, enabled: boolean): Promise<FeatureFlags> {
  if (!isFeatureFlagKey(key)) throw new Error(`Unknown feature flag "${String(key)}".`);
  if (typeof enabled !== "boolean") throw new Error("A feature flag is either on or off.");
  return resolveFeatureFlags(await db.call<unknown>("set_feature_flag", { p_key: key, p_enabled: enabled }));
}
