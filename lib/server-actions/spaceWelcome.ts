"use server";

import { readMySpaces } from "@/lib/spaces/server";
import { generateSpaceSubtitle, readSpaceKnowledge, refreshSpaceSubtitle, savedSpaceSubtitle } from "@/lib/spaces/subtitle";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc } from "@/lib/db/rpc";
import { readModelChoice } from "@/lib/ai/models";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { withSettledActor } from "@/lib/auth/currentPerson";
import { toActionResult } from "./result";

const pending = new Map<string, Promise<string | null>>();

// A generation finishing after a rename/deletion must not save stale copy.
async function saveSubtitle(space: { id: string; name: string }, ownerId: string, subtitle: string) {
  const { data, error } = await getAdminSupabase().from("spaces")
    .update({ subtitle, subtitle_for_name: space.name })
    .eq("id", space.id).eq("owner_id", ownerId).eq("name", space.name)
    .is("deleted_at", null).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  return data ? subtitle : null;
}

export async function readSpaceWelcome() {
  return toActionResult(async () => {
    const { activeSpace, account } = await readMySpaces();
    const stored = savedSpaceSubtitle(activeSpace);
    if (stored) return { spaceId: activeSpace.id, title: activeSpace.name, subtitle: stored };
    const key = JSON.stringify([account.id, activeSpace.id, activeSpace.name]);
    let task = pending.get(key);
    if (!task) {
      task = withSettledActor(async () => {
        const db = supabaseRpc(getAdminSupabase());
        const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call) => db.call("log_ai_call", { p_call: call }));
        if (!settings) return null;
        const subtitle = await generateSpaceSubtitle(activeSpace.name, settings);
        return saveSubtitle(activeSpace, account.id, subtitle);
      }).finally(() => { pending.delete(key); });
      pending.set(key, task);
    }
    return { spaceId: activeSpace.id, title: activeSpace.name, subtitle: await task };
  });
}

// The person asked for a new subtitle: unlike readSpaceWelcome this always calls
// the AI, and it reads what the space holds now instead of only its title.
export async function refreshSpaceWelcome() {
  return toActionResult(async () => {
    const { activeSpace, account } = await readMySpaces();
    const key = JSON.stringify(["refresh", account.id, activeSpace.id, activeSpace.name]);
    let task = pending.get(key);
    if (!task) {
      task = withSettledActor(async () => {
        const client = getAdminSupabase();
        const db = supabaseRpc(client);
        const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call) => db.call("log_ai_call", { p_call: call }));
        if (!settings) throw new Error("No AI provider is set up.");
        const knowledge = await readSpaceKnowledge(client);
        const subtitle = await refreshSpaceSubtitle(activeSpace.name, savedSpaceSubtitle(activeSpace), knowledge, settings);
        return saveSubtitle(activeSpace, account.id, subtitle);
      }).finally(() => { pending.delete(key); });
      pending.set(key, task);
    }
    const subtitle = await task;
    if (!subtitle) throw new Error("This space changed while updating. Try again.");
    return { spaceId: activeSpace.id, title: activeSpace.name, subtitle };
  });
}
