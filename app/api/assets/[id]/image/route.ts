import { requireUser } from "@/lib/auth/requireUser";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { z } from "zod";
import { optimizedMediaResponse } from "@/lib/media/optimize";
import { replaceStoredMedia } from "@/lib/media/replace";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requireUser(); } catch { return new Response("Not signed in", { status: 401 }); }
  const parsed = z.uuid().safeParse((await params).id);
  if (!parsed.success) return new Response("Not found", { status: 404 });
  const client = getAdminSupabase();
  const { data: asset } = await client.from("assets").select("storage_path,origin,mime_type").eq("id", parsed.data).single();
  if (!asset || !["generated", "external"].includes(asset.origin) || !asset.storage_path.startsWith("composer-images/")) return new Response("Not found", { status: 404 });
  const path = asset.storage_path.slice("composer-images/".length);
  const optimized = await optimizedMediaResponse(request, { bucket: "composer-images", path, mime: asset.mime_type, replace: (bytes, mime) => replaceStoredMedia("composer-images", path, bytes, mime), download: async () => {
    const result = await client.storage.from("composer-images").download(path);
    if (result.error || !result.data) throw new Error("Image unavailable");
    return result.data;
  } });
  if (optimized) return optimized;
  const { data, error } = await client.storage.from("composer-images").createSignedUrl(asset.storage_path.slice("composer-images/".length), 60);
  if (error || !data) return new Response("Image unavailable", { status: 404 });
  return new Response(null, { status: 307, headers: { Location: data.signedUrl, "Cache-Control": "private, no-store" } });
}
