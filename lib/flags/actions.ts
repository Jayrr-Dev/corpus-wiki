"use server";

import { currentAgentSession } from "@/lib/agents/session";
import { requireUser } from "@/lib/auth/requireUser";
import { supabaseRpc } from "@/lib/db/rpc";
import { type ActionResult, toActionResult } from "@/lib/server-actions/result";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { type FeatureFlagKey, isFeatureFlagKey } from "./registry";
import { saveFeatureFlag } from "./store";

// FEATURE FLAG: turns one registered flag on or off for the whole app (Settings > Features)
export async function setFeatureFlag(key: FeatureFlagKey, enabled: boolean): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    if (currentAgentSession()) throw new Error("Agents cannot change feature flags.");
    // The type stops unknown keys in code; this stops them from the browser
    if (!isFeatureFlagKey(key)) throw new Error(`Unknown feature flag "${String(key)}".`);
    if (typeof enabled !== "boolean") throw new Error("A feature flag is either on or off.");
    await saveFeatureFlag(supabaseRpc(getAdminSupabase()), key, enabled);
    return {};
  });
}
