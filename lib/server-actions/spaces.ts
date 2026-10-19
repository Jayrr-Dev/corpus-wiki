"use server";

import { requireUser } from "@/lib/auth/requireUser";
import { currentActor } from "@/lib/auth/currentPerson";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { selectOwnedSpace } from "@/lib/spaces/server";
import { isSpaceId, type Space } from "@/lib/spaces/shared";
import { toActionResult } from "./result";

export async function createSpace(name: string) {
  return toActionResult(async () => {
    await requireUser();
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80) throw new Error("Use a space name between 1 and 80 characters.");
    const space = await supabaseRpc(getAdminSupabase()).call<Space>("create_space", { p_name: name.trim() });
    await selectOwnedSpace(space.id);
    return { space };
  });
}

export async function switchSpace(id: string) {
  return toActionResult(async () => {
    if (typeof id !== "string" || !isSpaceId(id)) throw new Error("Choose a valid space.");
    await selectOwnedSpace(id);
    return {};
  });
}

export async function renameSpace(id: string, name: string) {
  return toActionResult(async () => {
    await requireUser();
    if (typeof id !== "string" || !isSpaceId(id)) throw new Error("Choose a valid space.");
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80) throw new Error("Use a space name between 1 and 80 characters.");
    const space = await supabaseRpc(getAdminSupabase()).call<Space>("rename_space", { p_id: id, p_name: name.trim() });
    return { space };
  });
}

export async function deleteSpace(id: string, confirmation: string) {
  return toActionResult(async () => {
    await requireUser();
    if (typeof id !== "string" || !isSpaceId(id)) throw new Error("Choose a valid space.");
    if (typeof confirmation !== "string" || !confirmation) throw new Error("Type the space name exactly to confirm deletion.");
    const { spaceId } = await currentActor();
    const replacement = await supabaseRpc(getAdminSupabase()).call<string>("delete_space", { p_id: id, p_name: confirmation });
    if (spaceId === id) await selectOwnedSpace(replacement);
    return {};
  });
}
