import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc } from "@/lib/db/rpc";
import { validateSvg } from "@/lib/composer/svg";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requireUser(); } catch { return new Response("Not signed in", { status: 401 }); }
  const parsed = z.uuid().safeParse((await params).id);
  if (!parsed.success) return new Response("Not found", { status: 404 });
  const asset = await supabaseRpc(getAdminSupabase()).call<{ svg: string } | null>("read_generated_asset", { p_asset_id: parsed.data });
  if (!asset || validateSvg(asset.svg).length) return new Response("Not found", { status: 404 });
  return new Response(asset.svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'" } });
}
