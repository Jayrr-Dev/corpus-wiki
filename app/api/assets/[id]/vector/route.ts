import { requireUser } from "@/lib/auth/requireUser";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc } from "@/lib/db/rpc";
import { validateVectorSvg } from "@/lib/composer/vectorSvg";
import { z } from "zod";
import { cachedSvgResponse } from "@/lib/media/svgResponse";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requireUser(); } catch { return new Response("Not signed in", { status: 401 }); }
  const parsed = z.uuid().safeParse((await params).id);
  if (!parsed.success) return new Response("Not found", { status: 404 });
  const asset = await supabaseRpc(getAdminSupabase()).call<{ svg: string } | null>("read_generated_asset", { p_asset_id: parsed.data });
  if (!asset || validateVectorSvg(asset.svg).length) return new Response("Vector unavailable", { status: 404 });
  return cachedSvgResponse(request, asset.svg);
}
