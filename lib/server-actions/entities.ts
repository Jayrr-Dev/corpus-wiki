"use server";

import { requireUser } from "@/lib/auth/requireUser";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { readChosenModel } from "@/lib/ai/models";
import { supabaseRpc } from "@/lib/db/rpc";
import { type DescribeBatchResult, describeEntityBatch, planDescribeBatches } from "@/lib/knowledge/entityDescriptions";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { type ActionResult, toActionResult } from "./result";

// =====================================================================
// DESCRIBE ENTITIES (called by /graph): plan the batches of entities
// still without a description, then the screen runs them one at a time
// so it can show progress.
// =====================================================================

// PLAN: the batches of entity ids to describe
export async function planDescribePass(): Promise<ActionResult<{ batches: string[][] }>> {
  return toActionResult(async () => {
    await requireUser();
    return { batches: await planDescribeBatches(getAdminSupabase()) };
  });
}

// ONE BATCH: the model describes these entities from the claims that mention them
export async function describeBatch(entityIds: string[]): Promise<ActionResult<DescribeBatchResult>> {
  return toActionResult(async () => {
    await requireUser();
    const client = getAdminSupabase();
    const db = supabaseRpc(client);
    const settings = tokenFactoryFromEnv(process.env, await readChosenModel(db), (call) => db.call("log_ai_call", { p_call: call }));
    if (!settings) throw new Error("Describing entities needs NEBIUS_API_KEY in the server env.");
    return describeEntityBatch({ client, settings }, entityIds);
  });
}
