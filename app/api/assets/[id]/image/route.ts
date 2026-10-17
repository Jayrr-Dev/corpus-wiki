import { requireUser } from "@/lib/auth/requireUser";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { z } from "zod";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requireUser(); } catch { return new Response("Not signed in", { status: 401 }); }
  const parsed = z.uuid().safeParse((await params).id);
  if (!parsed.success) return new Response("Not found", { status: 404 });
  const client = getAdminSupabase();
  const { data: asset } = await client.from("assets").select("storage_path,origin").eq("id", parsed.data).single();
  if (!asset || !["generated", "external"].includes(asset.origin) || !asset.storage_path.startsWith("composer-images/")) return new Response("Not found", { status: 404 });
  const { data, error } = await client.storage.from("composer-images").createSignedUrl(asset.storage_path.slice("composer-images/".length), 60);
  if (error || !data) return new Response("Image unavailable", { status: 404 });
  return new Response(null, { status: 307, headers: { Location: data.signedUrl, "Cache-Control": "private, no-store" } });
}
