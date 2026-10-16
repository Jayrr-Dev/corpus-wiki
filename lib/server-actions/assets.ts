"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc } from "@/lib/db/rpc";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { readChosenModel } from "@/lib/ai/models";
import { describeAssets as describe } from "@/lib/assets/describe";
import { toActionResult } from "./result";

const ASSETS_PER_CALL = 16;

// ASSETS (called by /assets): find new media in the sources, then have the Media analyst
// describe and tag them, a few batches per call (the screen calls again while some remain).
// `ids` describes just those assets again.
export async function describeAssets(options: { ids?: string[] } = {}) {
  return toActionResult(async () => {
    await requireUser();
    const ids = options.ids ? z.array(z.string().uuid()).max(200).parse(options.ids) : undefined;
    const client = getAdminSupabase();
    const db = supabaseRpc(client);
    const settings = tokenFactoryFromEnv(process.env, await readChosenModel(db), (call) => db.call("log_ai_call", { p_call: { ...call, role: "media_analyst" } }));
    if (!settings) throw new Error("Configure the AI provider in Settings to describe assets.");
    return describe(client, settings, ids ? { ids } : { limit: ASSETS_PER_CALL });
  });
}
