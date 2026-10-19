"use server";

import { readMySpaces } from "@/lib/spaces/server";
import { generateSpaceSubtitle, savedSpaceSubtitle } from "@/lib/spaces/subtitle";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc } from "@/lib/db/rpc";
import { readModelChoice } from "@/lib/ai/models";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { withSettledActor } from "@/lib/auth/currentPerson";
import { toActionResult } from "./result";

const pending = new Map<string, Promise<string | null>>();

export async function readSpaceWelcome() {
  return toActionResult(async () => {
    const { activeSpace, account } = await readMySpaces();
    const stored = savedSpaceSubtitle(activeSpace);
    if (stored) return { spaceId: activeSpace.id, title: activeSpace.name, subtitle: stored };
    const key = JSON.stringify([account.id, activeSpace.id, activeSpace.name]);
    let task = pending.get(key);
    if (!task) {
      task = withSettledActor(async () => {
        const client = getAdminSupabase();
        const db = supabaseRpc(client);
        const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call) => db.call("log_ai_call", { p_call: call }));
        if (!settings) return null;
        const subtitle = await generateSpaceSubtitle(activeSpace.name, settings);
        // A generation finishing after a rename/deletion must not save stale copy.
        const { data, error } = await client.from("spaces")
          .update({ subtitle, subtitle_for_name: activeSpace.name })
          .eq("id", activeSpace.id).eq("owner_id", account.id).eq("name", activeSpace.name)
          .is("deleted_at", null).select("id").maybeSingle();
        if (error) throw new Error(error.message);
        return data ? subtitle : null;
      }).finally(() => { pending.delete(key); });
      pending.set(key, task);
    }
    return { spaceId: activeSpace.id, title: activeSpace.name, subtitle: await task };
  });
}
