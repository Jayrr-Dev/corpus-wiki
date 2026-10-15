"use server";

import { requireUser } from "@/lib/auth/requireUser";
import { loadStageSkills } from "@/lib/ai/skills/server";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { readChosenModel } from "@/lib/ai/models";
import { supabaseRpc } from "@/lib/db/rpc";
import { type LinkBatchResult, linkUnitBatch, planLinkBatches } from "@/lib/ingest/linkExisting";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { type ActionResult, toActionResult } from "./result";

// =====================================================================
// LINK EXISTING CLAIMS (called by /graph): plan the batches, then the
// screen runs them one at a time so it can show progress.
// =====================================================================

// PLAN: the batches of unit ids to link
export async function planLinkPass(): Promise<ActionResult<{ batches: string[][] }>> {
  return toActionResult(async () => {
    await requireUser();
    return { batches: await planLinkBatches(getAdminSupabase()) };
  });
}

// ONE BATCH: the model links these units; the links commit as one AI ChangeSet
export async function linkBatch(unitIds: string[]): Promise<ActionResult<LinkBatchResult>> {
  return toActionResult(async () => {
    await requireUser();
    const client = getAdminSupabase();
    const db = supabaseRpc(client);
    const settings = tokenFactoryFromEnv(process.env, await readChosenModel(db));
    if (settings) settings.skills = await loadStageSkills(db);
    if (!settings) throw new Error("Linking needs NEBIUS_API_KEY in the server env.");
    return linkUnitBatch({ db, client, settings }, unitIds);
  });
}
