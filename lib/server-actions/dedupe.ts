"use server";

import { requireUser } from "@/lib/auth/requireUser";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { readChosenModel } from "@/lib/ai/models";
import { supabaseRpc } from "@/lib/db/rpc";
import { type DedupeBatchResult, dedupeCluster, planDedupeClusters } from "@/lib/ingest/dedupe";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { type ActionResult, toActionResult } from "./result";

// =====================================================================
// CLEANING CYCLE (called by /graph): plan the candidate clusters, then
// the screen runs them one at a time so it can show progress.
// =====================================================================

// PLAN: clusters of unit ids that might be duplicates
export async function planDedupePass(): Promise<ActionResult<{ clusters: string[][] }>> {
  return toActionResult(async () => {
    await requireUser();
    return { clusters: await planDedupeClusters(getAdminSupabase()) };
  });
}

// Clean duplicates is explicit authorization to apply the model-confirmed merges.
export async function dedupeBatch(unitIds: string[]): Promise<ActionResult<DedupeBatchResult>> {
  return toActionResult(async () => {
    await requireUser();
    const client = getAdminSupabase();
    const db = supabaseRpc(client);
    const settings = tokenFactoryFromEnv(process.env, await readChosenModel(db));
    if (!settings) throw new Error("The cleaning cycle needs NEBIUS_API_KEY in the server env.");
    return dedupeCluster({ db, client, settings }, unitIds, "apply");
  });
}

