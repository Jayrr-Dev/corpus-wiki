"use server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc } from "@/lib/db/rpc";
import { toActionResult } from "./result";

export async function graphHistory() {
  return toActionResult(async () => {
    await requireUser();
    return supabaseRpc(getAdminSupabase()).call<{ undo: { id: string; summary: string } | null; fingerprint: string }>("graph_edit_history");
  });
}

export async function stepGraphHistory(id: string, direction: "undo" | "redo", fingerprint: string) {
  return toActionResult(async () => {
    await requireUser();
    z.uuid().parse(id); z.enum(["undo", "redo"]).parse(direction); z.string().length(32).parse(fingerprint);
    return supabaseRpc(getAdminSupabase()).call<{ fingerprint: string }>("step_graph_history", { p_id: id, p_direction: direction, p_fingerprint: fingerprint });
  });
}
