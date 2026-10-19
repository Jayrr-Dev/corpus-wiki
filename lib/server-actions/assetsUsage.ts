"use server";

import { requireUser } from "@/lib/auth/requireUser";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { toActionResult } from "./result";

export type AssetPlacement = { assetId: string; kind: "article" | "source" | "knowledge" | "stakeholder"; title: string; href: string };

export async function readAssetUsage() {
  return toActionResult(async () => {
    await requireUser();
    const placements = await supabaseRpc(getAdminSupabase()).call<AssetPlacement[]>("asset_app_usage");
    return { placements };
  });
}
