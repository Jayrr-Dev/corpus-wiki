import "server-only";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc } from "@/lib/db/rpc";
import { validateSvg } from "./svg";

// Only load workspace-owned storage. Do not fetch arbitrary library URLs.
export async function loadComposerImage(id: string): Promise<Buffer | null> {
  const client = getAdminSupabase();
  const { data: asset, error } = await client.from("assets").select("storage_path,origin").eq("id", id).single();
  if (error) throw new Error("Could not read the image for visual review.");
  if (asset.storage_path.startsWith("composer-images/")) {
    const { data, error } = await client.storage.from("composer-images").download(asset.storage_path.slice("composer-images/".length));
    if (error || !data) throw new Error("Could not load the saved image for visual review.");
    return Buffer.from(await data.arrayBuffer());
  }
  if (asset.origin === "generated") {
    const content = await supabaseRpc(client).call<{ svg?: string } | null>("read_generated_asset", { p_asset_id: id });
    if (content?.svg && !validateSvg(content.svg).length) return Buffer.from(content.svg);
  }
  return null;
}
