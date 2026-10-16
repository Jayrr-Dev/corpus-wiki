"use server";

import { requireUser } from "@/lib/auth/requireUser";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { toActionResult } from "./result";

export async function saveDomainTab(values: { id?: string; name: string; description: string; rootIds: string[] }) {
  return toActionResult(async () => {
    await requireUser();
    const name = values.name.trim();
    const description = values.description.trim();
    if (!name || name.length > 80) throw new Error("Use a tab name of 1–80 characters.");
    if (!description || description.length > 2000) throw new Error("Describe eligible roots in 1–2000 characters.");
    const { supabaseRpc } = await import("@/lib/db/rpc");
    return await supabaseRpc(getAdminSupabase()).call<{ id: string }>("save_domain_tab", {
      p_id: values.id ?? null, p_name: name, p_description: description, p_root_ids: values.rootIds,
    });
  });
}
